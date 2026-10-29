package ai.openeyes.glasses.core

/** Typed forms of the openeyes-ai server replies. Field names match the server's JSON exactly. */

enum class Confidence { HIGH, MEDIUM, LOW }

enum class ResponseLength(val wire: String) { BRIEF("brief"), STANDARD("standard"), DETAILED("detailed") }

data class SceneChange(val category: String, val text: String)

/** Reply to task "scene_check": {summary, objects, changes[{category,text}], confidence}. */
data class SceneCheck(
    val summary: String,
    val objects: List<String>,
    val changes: List<SceneChange>,
    val confidence: Confidence,
)

enum class Visibility { VISIBLE, NOT_VISIBLE, UNCERTAIN }

/** Reply to task "find": {visibility, position, confidence, suggestion}. */
data class FindResult(
    val visibility: Visibility,
    val position: String,
    val confidence: Confidence,
    val suggestion: String,
)

/** Reply to task "read": the transcription only, never summarised or corrected. */
data class ReadResult(val text: String, val readable: Boolean)

enum class AnswerBasis { EXACT, SUMMARY, INFERENCE, NOT_FOUND }

/** Reply to task "ask_text": an answer grounded in the photo of the document. */
data class TextAnswer(val answer: String, val basis: AnswerBasis, val quote: String)

enum class ChatRole(val wire: String) { USER("user"), ASSISTANT("assistant") }

data class ChatTurn(val role: ChatRole, val content: String)
