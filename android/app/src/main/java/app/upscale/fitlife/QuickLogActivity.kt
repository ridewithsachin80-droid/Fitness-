package app.upscale.fitlife

import android.app.Activity
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Voice logging. Receives a dictated sentence from Assistant, posts it to
 * /api/quick-log, and speaks the reply.
 *
 * WHY THERE IS NO UI HERE
 * -----------------------
 * The whole point is that this works with the phone locked. Any UI — even a
 * toast or a progress spinner — forces an unlock and the feature is pointless.
 * So the theme is Theme.NoDisplay, the activity never calls setContentView,
 * and it finishes as soon as the reply has been spoken.
 *
 * THE TOKEN
 * ---------
 * A write-only credential issued by the web app (Settings > Voice logging) and
 * handed over via a deep link (see TokenReceiverActivity). It is stored in
 * EncryptedSharedPreferences rather than plain prefs: a rooted phone or a
 * backup extraction would otherwise expose a permanent credential.
 *
 * It can only write a day's log — it cannot read labs, change settings, or
 * issue another token. If it leaks, the damage is a wrong meal entry.
 */
class QuickLogActivity : Activity() {

    private var tts: TextToSpeech? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val spoken = extractSpokenText()
        if (spoken.isNullOrBlank()) {
            speakThenFinish("I did not catch that.")
            return
        }

        val token = readToken()
        if (token.isNullOrBlank()) {
            // A member who never set it up gets a reason, not silence.
            speakThenFinish("Voice logging is not set up. Open FitLife settings to turn it on.")
            return
        }

        // Networking off the main thread. A locked-screen activity gets very
        // little time, so this is deliberately one short request with a tight
        // timeout rather than anything clever.
        thread {
            val reply = postLog(token, spoken)
            runOnUiThread { speakThenFinish(reply) }
        }
    }

    /**
     * The dictated words, wherever Assistant put them.
     *
     * Different Assistant versions and different built-in intents deliver the
     * text under different extras, and the set has changed across releases.
     * Checking several is not defensive padding — it is the difference between
     * the feature working and silently doing nothing on a phone we did not
     * test.
     */
    private fun extractSpokenText(): String? {
        val keys = listOf(
            "android.intent.extra.TEXT",
            "query",
            "text",
            "message",
            "name"
        )
        for (k in keys) {
            val v = intent?.getStringExtra(k)
            if (!v.isNullOrBlank()) return v.trim()
        }
        return intent?.dataString?.takeIf { it.isNotBlank() }
    }

    private fun readToken(): String? = try {
        val master = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            this, "fitlife_secure", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        ).getString("quick_log_token", null)
    } catch (e: Exception) {
        null
    }

    /** @return the sentence to speak. Never throws; always says something. */
    private fun postLog(token: String, text: String): String {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("${BuildConfig.BASE_URL}/api/quick-log").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000
                readTimeout = 12000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            val body = JSONObject().put("text", text).put("source", "android").toString()
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader()?.use { it.readText() } ?: ""

            when {
                code == 401 -> "Voice logging needs setting up again in FitLife."
                code == 429 -> "Too many logs just now. Try again in a little while."
                raw.isBlank() -> "Something went wrong. Please log it in the app."
                else -> JSONObject(raw).optString("reply")
                    .ifBlank { "Logged." }
            }
        } catch (e: Exception) {
            // Offline, DNS, timeout. Say so plainly — a member who hears
            // nothing assumes it worked and does not log again.
            "Could not reach FitLife. Please log it in the app."
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Speaks, then finishes. TextToSpeech initialises asynchronously, so
     * finish() has to wait for the utterance to complete or the process is
     * killed mid-sentence.
     */
    private fun speakThenFinish(message: String) {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale("en", "IN")
                tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) { runOnUiThread { finish() } }
                    @Deprecated("deprecated in API 21")
                    override fun onError(utteranceId: String?) { runOnUiThread { finish() } }
                })
                tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "fitlife-reply")
            } else {
                // No TTS engine. Nothing useful left to do, so leave quietly
                // rather than hanging on a locked screen.
                finish()
            }
        }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}
