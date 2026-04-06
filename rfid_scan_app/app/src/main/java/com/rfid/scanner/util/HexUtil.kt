package com.rfid.scanner.util




object HexUtil {

    fun bytesToHexString(src: ByteArray, offset: Int, length: Int): String? {
        if (src.isEmpty()) return null
        val sb = StringBuilder()
        for (i in offset until length) {
            val v = src[i].toInt() and 0xFF
            val hv = Integer.toHexString(v)
            if (hv.length == 1) sb.append("0")
            sb.append(hv)
        }
        return sb.toString().uppercase()
    }

    fun hexStringToBytes(hexString: String?): ByteArray? {
        if (hexString.isNullOrEmpty()) return null
        val hex = hexString.uppercase()
        val length = hex.length / 2
        val result = ByteArray(length)
        for (i in 0 until length) {
            val pos = i * 2
            result[i] = (charToByte(hex[pos]) shl 4 or charToByte(hex[pos + 1])).toByte()
        }
        return result
    }

    private fun charToByte(c: Char): Int {
        return "0123456789ABCDEF".indexOf(c)
    }

    fun isValidHex(str: String): Boolean {
        return str.all { it in "0123456789ABCDEFabcdef" }
    }
}
