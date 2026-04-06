package com.rfid.scanner.util

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.rfid.scanner.data.model.ScannedTag
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object ExportUtil {

    fun exportToCsv(context: Context, tags: List<ScannedTag>): String {
        if (tags.isEmpty()) return "No data to export"

        val timestamp = SimpleDateFormat("yyyy-MM-dd_HHmmss", Locale.getDefault()).format(Date())
        val fileName = "RFID_Tags_$timestamp.csv"

        return try {
            val outputStream = getOutputStream(context, fileName)
            if (outputStream != null) {
                // Write header
                outputStream.write("EPC,Count,RSSI\n".toByteArray())

                // Write data
                for (tag in tags) {
                    val line = "${tag.epcId},${tag.count},${tag.rssi}\n"
                    outputStream.write(line.toByteArray())
                }

                outputStream.flush()
                outputStream.close()
                "Exported: $fileName"
            } else {
                "Export failed: Cannot create file"
            }
        } catch (e: Exception) {
            "Export failed: ${e.message}"
        }
    }

    private fun getOutputStream(context: Context, fileName: String): OutputStream? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ use MediaStore
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, "text/csv")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            uri?.let { context.contentResolver.openOutputStream(it) }
        } else {
            // Older Android use direct file
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, fileName)
            FileOutputStream(file)
        }
    }
}
