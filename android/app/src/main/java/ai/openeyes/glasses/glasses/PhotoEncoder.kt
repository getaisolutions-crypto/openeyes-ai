package ai.openeyes.glasses.glasses

import ai.openeyes.glasses.core.ImageSizing
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import com.meta.wearable.dat.camera.types.PhotoData
import java.io.ByteArrayOutputStream

/** Converts a toolkit photo to a downsized JPEG held in memory. Nothing is written to storage. */
internal object PhotoEncoder {

    fun toJpeg(photo: PhotoData): ByteArray? = when (photo) {
        is PhotoData.Bitmap -> encode(photo.bitmap, ownsBitmap = false)
        is PhotoData.HEIC -> decodeHeic(photo.data)?.let { encode(it, ownsBitmap = true) }
    }

    private fun decodeHeic(buffer: java.nio.ByteBuffer): Bitmap? = try {
        val bytes = ByteArray(buffer.remaining()).also { buffer.duplicate().get(it) }
        val source = ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))
        ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val (w, h) = ImageSizing.target(info.size.width, info.size.height)
            decoder.setTargetSize(w, h)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } catch (e: Exception) {
        null
    }

    private fun encode(source: Bitmap, ownsBitmap: Boolean): ByteArray? {
        if (source.width <= 0 || source.height <= 0) return null
        val (w, h) = ImageSizing.target(source.width, source.height)
        val scaled = if (w == source.width && h == source.height) source else Bitmap.createScaledBitmap(source, w, h, true)
        return try {
            ByteArrayOutputStream().use { out ->
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, ImageSizing.JPEG_QUALITY, out)) null else out.toByteArray()
            }
        } finally {
            if (scaled !== source) scaled.recycle()
            if (ownsBitmap) source.recycle()
        }
    }
}
