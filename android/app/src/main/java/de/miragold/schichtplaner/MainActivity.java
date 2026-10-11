package de.miragold.schichtplaner;

import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeAlarmPlugin.class); // eigener Wecker (WakeAlarmPlugin.java)
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            // alter Versuch (Ton über Benachrichtigungskanal) – wird durch den eigenen Wecker ersetzt
            if (nm != null) nm.deleteNotificationChannel("wecker_alarm");
        }
        WakeAlarmReceiver.ensureChannel(this);
    }
}
