package ai.openeyes.glasses.core

/** Size for the photo sent to Meta AI: longest side at most [maxSide], aspect ratio kept, never upscaled. */
object ImageSizing {
    const val MAX_SIDE = 1280
    const val JPEG_QUALITY = 80

    fun target(width: Int, height: Int, maxSide: Int = MAX_SIDE): Pair<Int, Int> {
        require(width > 0 && height > 0) { "Image has no size" }
        val longest = maxOf(width, height)
        if (longest <= maxSide) return width to height
        val scale = maxSide.toDouble() / longest
        return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
    }
}
