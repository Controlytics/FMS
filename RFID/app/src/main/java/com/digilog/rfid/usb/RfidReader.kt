package com.digilog.rfid.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.Ch34xSerialDriver
import com.hoho.android.usbserial.driver.Cp21xxSerialDriver
import com.hoho.android.usbserial.driver.FtdiSerialDriver
import com.hoho.android.usbserial.driver.ProbeTable
import com.hoho.android.usbserial.driver.ProlificSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.Executors

data class ScannedTag(
    val epc: String,
    var count: Int = 1,
    var rssi: Int = 0,
    val firstSeen: Long = System.currentTimeMillis(),
    var lastSeen: Long = System.currentTimeMillis()
)

enum class ConnectionState { DISCONNECTED, SEARCHING, FOUND, CONNECTING, CONNECTED, ERROR }

class RfidReader(private val context: Context) {

    companion object {
        private const val ACTION_USB_PERMISSION = "com.digilog.rfid.USB_PERMISSION"
        // KC-series UHF commands
        private val CMD_INVENTORY = byteArrayOf(0xBB.toByte(), 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E)
        private val CMD_STOP = byteArrayOf(0xBB.toByte(), 0x00, 0x28, 0x00, 0x00, 0x28, 0x7E)
        private val CMD_GET_VERSION = byteArrayOf(0xBB.toByte(), 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E)
        private val CMD_SET_POWER_PREFIX = byteArrayOf(0xBB.toByte(), 0x00, 0xB6.toByte(), 0x00, 0x02)
        private val CMD_UKB_ON = byteArrayOf(0xBB.toByte(), 0x00, 0x69, 0x00, 0x01, 0x01, 0x6B, 0x7E)
        private val CMD_UKB_OFF = byteArrayOf(0xBB.toByte(), 0x00, 0x69, 0x00, 0x01, 0x00, 0x6A, 0x7E)
    }

    private var port: UsbSerialPort? = null
    private var ioManager: SerialInputOutputManager? = null
    private val buffer = mutableListOf<Byte>()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _statusMessage = MutableStateFlow("Ready")
    val statusMessage: StateFlow<String> = _statusMessage

    private val _tags = MutableStateFlow<List<ScannedTag>>(emptyList())
    val tags: StateFlow<List<ScannedTag>> = _tags

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning

    private val _totalReads = MutableStateFlow(0)
    val totalReads: StateFlow<Int> = _totalReads

    private val _lastResponse = MutableStateFlow("")
    val lastResponse: StateFlow<String> = _lastResponse

    private val _ukbEnabled = MutableStateFlow(false)
    val ukbEnabled: StateFlow<Boolean> = _ukbEnabled

    private var usbDevice: UsbDevice? = null
    private var driver: UsbSerialDriver? = null

    private val permissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action == ACTION_USB_PERMISSION) {
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                if (granted) {
                    openConnection()
                } else {
                    _connectionState.value = ConnectionState.ERROR
                    _statusMessage.value = "USB permission denied"
                }
            }
        }
    }

    init {
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(permissionReceiver, filter)
        }
    }

    fun searchDevice() {
        _connectionState.value = ConnectionState.SEARCHING
        _statusMessage.value = "Searching for USB device..."

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        // Try default prober first
        var availableDrivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)

        // If not found, try custom prober with KC-series VID/PIDs
        if (availableDrivers.isEmpty()) {
            val customTable = ProbeTable()
            // KC-series UHF reader
            customTable.addProduct(10473, 20993, Ch34xSerialDriver::class.java)
            customTable.addProduct(10473, 20993, CdcAcmSerialDriver::class.java)
            // Common CH340 chips used in RFID readers
            customTable.addProduct(6790, 29987, Ch34xSerialDriver::class.java)
            customTable.addProduct(4292, 60000, Cp21xxSerialDriver::class.java)
            customTable.addProduct(1027, 24577, FtdiSerialDriver::class.java)
            customTable.addProduct(1659, 8963, ProlificSerialDriver::class.java)
            availableDrivers = UsbSerialProber(customTable).findAllDrivers(usbManager)
        }

        // If still not found, try to use any connected USB device with CH340 driver
        if (availableDrivers.isEmpty()) {
            val devices = usbManager.deviceList
            if (devices.isEmpty()) {
                _connectionState.value = ConnectionState.ERROR
                _statusMessage.value = "No USB devices found. Check cable connection."
                return
            }
            // Try each device with CH340 driver (most common for RFID readers)
            for (dev in devices.values) {
                _statusMessage.value = "Found USB device VID:${dev.vendorId} PID:${dev.productId}, trying drivers..."
                val customTable = ProbeTable()
                customTable.addProduct(dev.vendorId, dev.productId, Ch34xSerialDriver::class.java)
                customTable.addProduct(dev.vendorId, dev.productId, CdcAcmSerialDriver::class.java)
                customTable.addProduct(dev.vendorId, dev.productId, Cp21xxSerialDriver::class.java)
                availableDrivers = UsbSerialProber(customTable).findAllDrivers(usbManager)
                if (availableDrivers.isNotEmpty()) break
            }
        }

        if (availableDrivers.isEmpty()) {
            val devices = usbManager.deviceList
            val devInfo = devices.values.firstOrNull()?.let { "VID:${it.vendorId} PID:${it.productId}" } ?: "none"
            _connectionState.value = ConnectionState.ERROR
            _statusMessage.value = "No compatible driver found. Device: $devInfo. Try unplugging and replugging."
            return
        }

        driver = availableDrivers[0]
        usbDevice = driver!!.device
        _connectionState.value = ConnectionState.FOUND
        _statusMessage.value = "USB device found (VID:${usbDevice!!.vendorId} PID:${usbDevice!!.productId})"
    }

    fun connect() {
        if (driver == null) {
            searchDevice()
            if (driver == null) return
        }

        _connectionState.value = ConnectionState.CONNECTING
        _statusMessage.value = "Connecting..."

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        if (!usbManager.hasPermission(usbDevice)) {
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_MUTABLE else 0
            val permissionIntent = PendingIntent.getBroadcast(context, 0,
                Intent(ACTION_USB_PERMISSION), flags)
            usbManager.requestPermission(usbDevice, permissionIntent)
            _statusMessage.value = "Requesting USB permission..."
            return
        }

        openConnection()
    }

    private fun openConnection() {
        try {
            val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
            val connection = usbManager.openDevice(driver!!.device)
                ?: throw Exception("Could not open USB device")

            port = driver!!.ports[0]
            port!!.open(connection)
            // Try 115200 first (most common), then 57600, 9600
            port!!.setParameters(115200, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            port!!.dtr = true
            port!!.rts = true

            ioManager = SerialInputOutputManager(port!!, object : SerialInputOutputManager.Listener {
                override fun onNewData(data: ByteArray) {
                    processIncomingData(data)
                }
                override fun onRunError(e: Exception) {
                    _statusMessage.value = "Connection error: ${e.message}"
                    _connectionState.value = ConnectionState.ERROR
                }
            })
            Executors.newSingleThreadExecutor().submit(ioManager!!)

            _connectionState.value = ConnectionState.CONNECTED
            _statusMessage.value = "Connected successfully!"
        } catch (e: Exception) {
            _connectionState.value = ConnectionState.ERROR
            _statusMessage.value = "Connection failed: ${e.message}"
        }
    }

    fun disconnect() {
        _isScanning.value = false
        ioManager?.listener = null
        ioManager?.stop()
        ioManager = null
        try { port?.close() } catch (_: Exception) {}
        port = null
        driver = null
        usbDevice = null
        _connectionState.value = ConnectionState.DISCONNECTED
        _statusMessage.value = "Disconnected"
    }

    private val _rawDebug = MutableStateFlow("")
    val rawDebug: StateFlow<String> = _rawDebug

    fun startScan() {
        if (_connectionState.value != ConnectionState.CONNECTED) return
        _isScanning.value = true
        _statusMessage.value = "Scanning..."
        _rawDebug.value = "Sending inventory cmd..."
        sendCommand(CMD_INVENTORY)
    }

    fun stopScan() {
        _isScanning.value = false
        sendCommand(CMD_STOP)
        _statusMessage.value = "Scan stopped. ${_tags.value.size} unique tags found."
    }

    fun clearTags() {
        _tags.value = emptyList()
        _totalReads.value = 0
    }

    fun readTag(epc: String, memBank: Int, wordPtr: Int, wordLen: Int, password: String = "00000000") {
        val epcBytes = hexToBytes(epc)
        val pwdBytes = hexToBytes(password)
        // Build read command: BB 00 39 [len] [pwd(4)] [memBank] [wordPtr(2)] [wordLen(2)] [epcLen] [epc...] [checksum] 7E
        val payload = mutableListOf<Byte>()
        payload.addAll(pwdBytes.toList())
        payload.add(memBank.toByte())
        payload.add((wordPtr shr 8).toByte())
        payload.add((wordPtr and 0xFF).toByte())
        payload.add((wordLen shr 8).toByte())
        payload.add((wordLen and 0xFF).toByte())
        payload.add(epcBytes.size.toByte())
        payload.addAll(epcBytes.toList())

        val cmd = buildCommand(0x39, payload.toByteArray())
        sendCommand(cmd)
    }

    fun writeTag(epc: String, memBank: Int, wordPtr: Int, data: String, password: String = "00000000") {
        val epcBytes = hexToBytes(epc)
        val pwdBytes = hexToBytes(password)
        val dataBytes = hexToBytes(data)
        val wordLen = dataBytes.size / 2

        val payload = mutableListOf<Byte>()
        payload.addAll(pwdBytes.toList())
        payload.add(memBank.toByte())
        payload.add((wordPtr shr 8).toByte())
        payload.add((wordPtr and 0xFF).toByte())
        payload.add((wordLen shr 8).toByte())
        payload.add((wordLen and 0xFF).toByte())
        payload.add(epcBytes.size.toByte())
        payload.addAll(epcBytes.toList())
        payload.addAll(dataBytes.toList())

        val cmd = buildCommand(0x49, payload.toByteArray())
        sendCommand(cmd)
    }

    fun setPower(dbm: Int) {
        val power = (dbm * 100)
        val payload = byteArrayOf((power shr 8).toByte(), (power and 0xFF).toByte())
        val cmd = buildCommand(0xB6.toByte().toInt(), payload)
        sendCommand(cmd)
    }

    fun enableUkbMode(enable: Boolean) {
        sendCommand(if (enable) CMD_UKB_ON else CMD_UKB_OFF)
        _ukbEnabled.value = enable
        _statusMessage.value = if (enable) "UKB Mode enabled — reader acts as keyboard" else "UKB Mode disabled"
    }

    private fun sendCommand(cmd: ByteArray) {
        try {
            port?.write(cmd, 200)
        } catch (e: Exception) {
            _statusMessage.value = "Send error: ${e.message}"
        }
    }

    private fun buildCommand(cmdCode: Int, payload: ByteArray): ByteArray {
        val len = payload.size
        val cmd = mutableListOf<Byte>()
        cmd.add(0xBB.toByte()) // header
        cmd.add(0x00)          // type
        cmd.add(cmdCode.toByte())
        cmd.add((len shr 8).toByte())
        cmd.add((len and 0xFF).toByte())
        cmd.addAll(payload.toList())
        // Checksum: sum of type + cmd + len(2) + payload
        var checksum = 0
        for (i in 1 until cmd.size) checksum += (cmd[i].toInt() and 0xFF)
        cmd.add((checksum and 0xFF).toByte())
        cmd.add(0x7E) // tail
        return cmd.toByteArray()
    }

    private fun processIncomingData(data: ByteArray) {
        // Debug: show raw hex of received data
        val hex = data.joinToString(" ") { "%02X".format(it) }
        _rawDebug.value = "RX[${data.size}]: $hex"

        synchronized(buffer) {
            buffer.addAll(data.toList())
            while (buffer.size >= 7) {
                // Find header 0xBB
                val headerIdx = buffer.indexOf(0xBB.toByte())
                if (headerIdx < 0) { buffer.clear(); return }
                if (headerIdx > 0) { buffer.subList(0, headerIdx).clear() }

                if (buffer.size < 5) return
                val dataLen = ((buffer[3].toInt() and 0xFF) shl 8) or (buffer[4].toInt() and 0xFF)
                val totalLen = 5 + dataLen + 2 // header(1) + type(1) + cmd(1) + len(2) + data + checksum(1) + tail(1)

                if (buffer.size < totalLen) return

                val packet = buffer.subList(0, totalLen).toByteArray()
                buffer.subList(0, totalLen).clear()

                parsePacket(packet)
            }
        }
    }

    private fun parsePacket(packet: ByteArray) {
        if (packet.size < 7) return
        val cmdCode = packet[2].toInt() and 0xFF

        when (cmdCode) {
            0x22 -> parseInventoryResponse(packet)  // Inventory/scan response
            0x39 -> parseReadResponse(packet)        // Read response
            0x49 -> parseWriteResponse(packet)       // Write response
            0x69 -> { /* UKB mode response */ }
            0xB6 -> { _statusMessage.value = "Power set successfully" }
            0xFF -> parseErrorResponse(packet)       // Error
        }

        // If scanning, send another inventory command for continuous scan
        if (_isScanning.value && cmdCode == 0x22) {
            sendCommand(CMD_INVENTORY)
        }
    }

    private fun parseInventoryResponse(packet: ByteArray) {
        if (packet.size < 12) return
        val dataLen = ((packet[3].toInt() and 0xFF) shl 8) or (packet[4].toInt() and 0xFF)
        if (dataLen < 5) return

        val rssi = packet[5].toInt() and 0xFF
        // PC (2 bytes) at 6-7, then EPC
        val epcLen = dataLen - 5 // subtract rssi(1) + pc(2) + crc(2)
        if (epcLen <= 0 || packet.size < 8 + epcLen) return

        val epcBytes = packet.sliceArray(8 until (8 + epcLen))
        val epc = bytesToHex(epcBytes)

        _totalReads.value++

        val currentTags = _tags.value.toMutableList()
        val existing = currentTags.find { it.epc == epc }
        if (existing != null) {
            existing.count++
            existing.rssi = rssi
            existing.lastSeen = System.currentTimeMillis()
        } else {
            currentTags.add(ScannedTag(epc = epc, rssi = rssi))
        }
        _tags.value = currentTags
    }

    private fun parseReadResponse(packet: ByteArray) {
        val dataLen = ((packet[3].toInt() and 0xFF) shl 8) or (packet[4].toInt() and 0xFF)
        if (dataLen < 1) {
            _lastResponse.value = "Read failed"
            return
        }
        val readData = packet.sliceArray(5 until (5 + dataLen))
        _lastResponse.value = bytesToHex(readData)
        _statusMessage.value = "Read successful: ${_lastResponse.value}"
    }

    private fun parseWriteResponse(packet: ByteArray) {
        _statusMessage.value = "Write successful!"
        _lastResponse.value = "OK"
    }

    private fun parseErrorResponse(packet: ByteArray) {
        val errorCode = if (packet.size > 5) packet[5].toInt() and 0xFF else -1
        val errorMsg = when (errorCode) {
            0x09 -> "No tag found in range"
            0x0A -> "Read failed — check password"
            0x0B -> "Write failed — check password or data"
            0x0C -> "Lock failed"
            0x0D -> "Kill failed"
            else -> "Error code: $errorCode"
        }
        _statusMessage.value = errorMsg
        _lastResponse.value = "ERROR: $errorMsg"
    }

    private fun hexToBytes(hex: String): ByteArray {
        val clean = hex.replace(" ", "")
        return ByteArray(clean.length / 2) { i ->
            clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02X".format(it) }
    }

    fun destroy() {
        disconnect()
        try { context.unregisterReceiver(permissionReceiver) } catch (_: Exception) {}
    }
}
