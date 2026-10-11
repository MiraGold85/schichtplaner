package de.miragold.schichtplaner;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Wird zur Weckzeit von Android aufgerufen: zeigt die Erinnerung an und spielt den Ton
 * über die Wecker-Audiospur ab – dadurch auch hörbar, wenn das Handy lautlos ist.
 * Nach einem Neustart/Update werden hier die gespeicherten Wecktöne neu eingeplant.
 */
public class WakeAlarmReceiver extends BroadcastReceiver {
    static final String CHANNEL = "wecker_anzeige";
    private static final long MAX_PLAY_MS = 8000;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (!WakeAlarmScheduler.ACTION_WAKE.equals(action)) {
            WakeAlarmScheduler.scheduleStored(ctx); // BOOT_COMPLETED, MY_PACKAGE_REPLACED
            return;
        }
        int id = intent.getIntExtra("id", 0);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        showNotification(ctx, id, title != null ? title : "Schichtplaner", body != null ? body : "");
        playSound(ctx, intent.getStringExtra("sound"), goAsync());
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Erster Termin (Weckton)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Anzeige zum Weckton – der Ton selbst kommt über die Wecker-Lautstärke");
        ch.setSound(null, null); // Ton spielt die App selbst ab
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    private void showNotification(Context ctx, int id, String title, String body) {
        ensureChannel(ctx);
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent open = PendingIntent.getActivity(ctx, id, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(0xFF4F46E5)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVibrate(new long[] { 0, 400, 200, 400 })
                .setAutoCancel(true)
                .setContentIntent(open);
        try {
            NotificationManagerCompat.from(ctx).notify(500000 + id, b.build());
        } catch (SecurityException e) {
            // Benachrichtigungen nicht erlaubt – der Ton kommt trotzdem
        }
    }

    private void playSound(Context ctx, String sound, PendingResult result) {
        AtomicBoolean done = new AtomicBoolean(false);
        MediaPlayer player = new MediaPlayer();
        Runnable finish = () -> {
            if (done.getAndSet(true)) return;
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            result.finish();
        };
        try {
            Uri uri = null;
            if ("system".equals(sound)) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + ctx.getPackageName() + "/raw/wecker");
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(ctx, uri);
            player.setOnCompletionListener(mp -> finish.run());
            player.setOnErrorListener((mp, what, extra) -> { finish.run(); return true; });
            player.prepare();
            player.start();
            new Handler(Looper.getMainLooper()).postDelayed(finish, MAX_PLAY_MS);
        } catch (Exception e) {
            finish.run();
        }
    }
}
