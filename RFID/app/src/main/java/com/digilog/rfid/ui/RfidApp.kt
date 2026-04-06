package com.digilog.rfid.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.digilog.rfid.usb.ConnectionState
import com.digilog.rfid.usb.RfidReader
import com.digilog.rfid.usb.ScannedTag

@Composable
fun RfidApp() {
    val context = LocalContext.current
    val reader = remember { RfidReader(context) }
    var selectedTab by remember { mutableIntStateOf(0) }

    val connectionState by reader.connectionState.collectAsState()
    val statusMessage by reader.statusMessage.collectAsState()
    val tags by reader.tags.collectAsState()
    val isScanning by reader.isScanning.collectAsState()
    val totalReads by reader.totalReads.collectAsState()
    val lastResponse by reader.lastResponse.collectAsState()
    val ukbEnabled by reader.ukbEnabled.collectAsState()
    val rawDebug by reader.rawDebug.collectAsState()

    DisposableEffect(Unit) { onDispose { reader.destroy() } }

    val tabs = listOf("Connect", "Scan", "Read/Write", "Settings")
    val icons = listOf(Icons.Default.Usb, Icons.Default.QrCodeScanner, Icons.Default.Edit, Icons.Default.Settings)

    Scaffold(
        bottomBar = {
            NavigationBar(containerColor = Color.White, tonalElevation = 8.dp) {
                tabs.forEachIndexed { index, title ->
                    NavigationBarItem(
                        icon = { Icon(icons[index], contentDescription = title) },
                        label = { Text(title, fontSize = 11.sp) },
                        selected = selectedTab == index,
                        onClick = { selectedTab = index }
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize().background(Color(0xFFF8FAFC))) {
            when (selectedTab) {
                0 -> ConnectScreen(reader, connectionState, statusMessage) { selectedTab = 1 }
                1 -> ScanScreen(reader, tags, isScanning, totalReads, statusMessage, rawDebug)
                2 -> ReadWriteScreen(reader, tags, lastResponse, statusMessage)
                3 -> SettingsScreen(reader, ukbEnabled, statusMessage)
            }
        }
    }
}

@Composable
fun ConnectScreen(reader: RfidReader, state: ConnectionState, status: String, onConnected: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Usb, contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = when (state) {
                ConnectionState.CONNECTED -> Color(0xFF28A745)
                ConnectionState.ERROR -> Color(0xFFDC3545)
                else -> Color(0xFF1A73E8)
            }
        )
        Spacer(Modifier.height(24.dp))
        Text("RFID Scanner", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E293B))
        Text("DigiLog Filter Management", fontSize = 14.sp, color = Color(0xFF64748B))
        Spacer(Modifier.height(32.dp))

        Card(
            Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                StatusChip(state, status)
                Spacer(Modifier.height(20.dp))

                when (state) {
                    ConnectionState.DISCONNECTED, ConnectionState.ERROR -> {
                        Button(
                            onClick = { reader.searchDevice() },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A73E8))
                        ) { Text("Search Device") }
                    }
                    ConnectionState.FOUND -> {
                        Button(
                            onClick = { reader.connect() },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF28A745))
                        ) { Text("Connect") }
                    }
                    ConnectionState.CONNECTED -> {
                        Button(
                            onClick = onConnected,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0891B2))
                        ) { Text("Start Scanning") }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { reader.disconnect() },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp)
                        ) { Text("Disconnect") }
                    }
                    else -> {
                        CircularProgressIndicator(color = Color(0xFF1A73E8))
                    }
                }
            }
        }
    }
}

@Composable
fun StatusChip(state: ConnectionState, message: String) {
    val (color, bg) = when (state) {
        ConnectionState.CONNECTED -> Color(0xFF28A745) to Color(0xFFD4EDDA)
        ConnectionState.ERROR -> Color(0xFFDC3545) to Color(0xFFF8D7DA)
        ConnectionState.FOUND -> Color(0xFF0891B2) to Color(0xFFD1ECF1)
        else -> Color(0xFF64748B) to Color(0xFFF1F5F9)
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(bg).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(10.dp))
        Text(message, fontSize = 13.sp, color = color, maxLines = 2)
    }
}

@Composable
fun ScanScreen(reader: RfidReader, tags: List<ScannedTag>, isScanning: Boolean, totalReads: Int, status: String, rawDebug: String = "") {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Tag Scanner", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E293B))
        if (rawDebug.isNotBlank()) {
            Text(rawDebug, fontSize = 9.sp, fontFamily = FontFamily.Monospace, color = Color(0xFF94A3B8), maxLines = 2)
        }
        Text(status, fontSize = 11.sp, color = Color(0xFF64748B), maxLines = 1)
        Spacer(Modifier.height(8.dp))

        // Stats row
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatCard("Tags", "${tags.size}", Color(0xFF1A73E8), Modifier.weight(1f))
            StatCard("Total", "$totalReads", Color(0xFF0891B2), Modifier.weight(1f))
            StatCard("Speed", "${if (isScanning && totalReads > 0) totalReads / ((System.currentTimeMillis() - (tags.firstOrNull()?.firstSeen ?: System.currentTimeMillis())).coerceAtLeast(1000) / 1000) else 0}/s", Color(0xFF28A745), Modifier.weight(1f))
        }

        Spacer(Modifier.height(12.dp))

        // Scan/Stop + Clear buttons
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { if (isScanning) reader.stopScan() else reader.startScan() },
                modifier = Modifier.weight(1f).height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isScanning) Color(0xFFDC3545) else Color(0xFF1A73E8)
                )
            ) { Text(if (isScanning) "Stop" else "Scan") }

            OutlinedButton(
                onClick = { reader.clearTags() },
                modifier = Modifier.weight(1f).height(48.dp),
                shape = RoundedCornerShape(12.dp)
            ) { Text("Clear") }
        }

        Spacer(Modifier.height(12.dp))

        // Tag list
        Card(
            Modifier.fillMaxSize(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            if (tags.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.QrCodeScanner, null, Modifier.size(48.dp), tint = Color(0xFFCBD5E1))
                        Spacer(Modifier.height(8.dp))
                        Text("No tags scanned yet", color = Color(0xFF94A3B8), fontSize = 14.sp)
                        Text("Tap Scan and hold reader near tags", color = Color(0xFFCBD5E1), fontSize = 12.sp)
                    }
                }
            } else {
                LazyColumn(Modifier.padding(8.dp)) {
                    // Header
                    item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text("EPC", Modifier.weight(1f), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                            Text("Count", Modifier.width(50.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B), textAlign = TextAlign.Center)
                            Text("RSSI", Modifier.width(50.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B), textAlign = TextAlign.Center)
                        }
                        HorizontalDivider(color = Color(0xFFE2E8F0))
                    }
                    items(tags) { tag ->
                        TagRow(tag)
                    }
                }
            }
        }
    }
}

@Composable
fun TagRow(tag: ScannedTag) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            tag.epc, Modifier.weight(1f),
            fontSize = 12.sp, fontFamily = FontFamily.Monospace,
            color = Color(0xFF1E293B), maxLines = 1, overflow = TextOverflow.Ellipsis
        )
        Text(
            "${tag.count}", Modifier.width(50.dp),
            fontSize = 13.sp, fontWeight = FontWeight.Bold,
            color = Color(0xFF1A73E8), textAlign = TextAlign.Center
        )
        val rssiColor = when {
            tag.rssi >= 80 -> Color(0xFFDC3545)
            tag.rssi >= 60 -> Color(0xFFFFC107)
            else -> Color(0xFF28A745)
        }
        Text(
            "${tag.rssi}", Modifier.width(50.dp),
            fontSize = 13.sp, fontWeight = FontWeight.Bold,
            color = rssiColor, textAlign = TextAlign.Center
        )
    }
    HorizontalDivider(color = Color(0xFFF1F5F9))
}

@Composable
fun StatCard(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Card(
        modifier, shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White)
    ) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = color)
            Text(label, fontSize = 11.sp, color = Color(0xFF94A3B8))
        }
    }
}

@Composable
fun ReadWriteScreen(reader: RfidReader, tags: List<ScannedTag>, lastResponse: String, status: String) {
    var epc by remember { mutableStateOf("") }
    var memBank by remember { mutableIntStateOf(3) } // User memory default
    var wordPtr by remember { mutableStateOf("0") }
    var wordLen by remember { mutableStateOf("6") }
    var password by remember { mutableStateOf("00000000") }
    var writeData by remember { mutableStateOf("") }

    val memBanks = listOf("Reserved", "EPC", "TID", "User")

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Read / Write", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E293B))
        Spacer(Modifier.height(12.dp))

        Card(
            Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // EPC input
                OutlinedTextField(
                    value = epc, onValueChange = { epc = it.uppercase() },
                    label = { Text("EPC (Tag ID)") },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                    singleLine = true
                )

                // Quick select from scanned tags
                if (tags.isNotEmpty()) {
                    Text("Recent tags:", fontSize = 11.sp, color = Color(0xFF64748B))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        tags.take(3).forEach { tag ->
                            AssistChip(
                                onClick = { epc = tag.epc },
                                label = { Text(tag.epc.take(12) + "...", fontSize = 10.sp) }
                            )
                        }
                    }
                }

                // Memory bank selector
                Text("Memory Bank", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Color(0xFF475569))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    memBanks.forEachIndexed { idx, name ->
                        FilterChip(
                            selected = memBank == idx,
                            onClick = { memBank = idx },
                            label = { Text(name, fontSize = 12.sp) }
                        )
                    }
                }

                // Word Ptr + Length
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = wordPtr, onValueChange = { wordPtr = it },
                        label = { Text("Word Ptr") },
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = wordLen, onValueChange = { wordLen = it },
                        label = { Text("Length") },
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                }

                // Password
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("Access Password") },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                    singleLine = true
                )

                // Read button
                Button(
                    onClick = {
                        reader.readTag(epc, memBank, wordPtr.toIntOrNull() ?: 0, wordLen.toIntOrNull() ?: 6, password)
                    },
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A73E8)),
                    enabled = epc.isNotBlank()
                ) { Text("Read") }

                // Write section
                HorizontalDivider()
                OutlinedTextField(
                    value = writeData, onValueChange = { writeData = it.uppercase() },
                    label = { Text("Write Data (Hex)") },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                    singleLine = true,
                    placeholder = { Text("e.g. 48454C4C4F") }
                )
                Button(
                    onClick = {
                        reader.writeTag(epc, memBank, wordPtr.toIntOrNull() ?: 0, writeData, password)
                    },
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFC107)),
                    enabled = epc.isNotBlank() && writeData.isNotBlank()
                ) { Text("Write", color = Color(0xFF1E293B)) }

                // Response
                if (lastResponse.isNotBlank()) {
                    Card(
                        Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text("Response:", fontSize = 11.sp, color = Color(0xFF64748B))
                            Text(lastResponse, fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = Color(0xFF1E293B))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(reader: RfidReader, ukbEnabled: Boolean, status: String) {
    var power by remember { mutableStateOf("20") }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF1E293B))
        Spacer(Modifier.height(12.dp))

        Card(
            Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White)
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // RF Power
                Text("RF Power (dBm)", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = power, onValueChange = { power = it },
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        suffix = { Text("dBm") }
                    )
                    Button(
                        onClick = { reader.setPower(power.toIntOrNull() ?: 20) },
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A73E8))
                    ) { Text("Set") }
                }
                Text("Range: 0-33 dBm. Higher = longer range but more power.", fontSize = 11.sp, color = Color(0xFF94A3B8))

                HorizontalDivider()

                // UKB Mode
                Text("UKB Mode (USB Keyboard)", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text(
                    "When enabled, scanned tag EPCs are typed as keyboard input into any focused text field (browser, notes, etc).",
                    fontSize = 12.sp, color = Color(0xFF64748B)
                )
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        if (ukbEnabled) "UKB Mode: ON" else "UKB Mode: OFF",
                        fontWeight = FontWeight.Bold,
                        color = if (ukbEnabled) Color(0xFF28A745) else Color(0xFF64748B)
                    )
                    Switch(
                        checked = ukbEnabled,
                        onCheckedChange = { reader.enableUkbMode(it) },
                        colors = SwitchDefaults.colors(checkedTrackColor = Color(0xFF28A745))
                    )
                }

                if (ukbEnabled) {
                    Card(
                        Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFD4EDDA)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            "UKB Mode is active. Scanned tags will be typed as keyboard input. Open DigiLog web app and tap the RFID input field, then scan a tag.",
                            Modifier.padding(12.dp), fontSize = 12.sp, color = Color(0xFF155724)
                        )
                    }
                }

                HorizontalDivider()

                // Status
                Text("Status", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(status, Modifier.padding(12.dp), fontSize = 13.sp, color = Color(0xFF475569))
                }
            }
        }
    }
}
