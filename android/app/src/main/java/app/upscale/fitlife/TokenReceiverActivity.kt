package app.upscale.fitlife

import android.app.Activity
import android.os.Bundle
import android.widget.Toast
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Receives the voice-logging token from the web app.
 *
 * Settings > Voice logging deep-links to fitlife://quick-log-token?t=<token>
 * when the app is installed, so the member never copies a 64-character string
 * by hand. That copy step is exactly where non-technical members give up.
 *
 * Stored in EncryptedSharedPreferences. Rotating the token server-side
 * invalidates whatever is stored here on the next request, so there is no
 * native cleanup to do when a member turns voice logging off.
 */
class TokenReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val token = intent?.data?.getQueryParameter("t")

        if (token.isNullOrBlank() || token.length < 32) {
            Toast.makeText(this, "That setup code did not look right.", Toast.LENGTH_LONG).show()
            finish(); return
        }

        try {
            val master = MasterKey.Builder(this)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                this, "fitlife_secure", master,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            ).edit().putString("quick_log_token", token).apply()

            Toast.makeText(this, "Voice logging is ready. Say: Hey Google, log with FitLife",
                Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Could not save the setup code.", Toast.LENGTH_LONG).show()
        }
        finish()
    }
}
