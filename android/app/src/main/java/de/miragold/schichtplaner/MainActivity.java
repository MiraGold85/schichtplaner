package de.miragold.schichtplaner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createAlarmChannel();
    }

    // Kanal für den Weckton beim ersten Termin des Tages. Der Ton läuft über die
    // Wecker-Lautstärke (USAGE_ALARM) und klingelt deshalb auch, wenn das Handy
    // auf lautlos oder Vibration steht – wie ein normaler Wecker.
    private void createAlarmChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel("wecker_alarm") != null) return;

        NotificationChannel channel = new NotificationChannel(
                "wecker_alarm", "Erster Termin (Weckton, auch bei lautlos)", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Erinnerung zum Losfahren beim ersten Termin des Tages – klingelt wie ein Wecker");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/raw/wecker");
        channel.setSound(sound, attributes);
        nm.createNotificationChannel(channel);
    }
}
