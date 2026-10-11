package de.miragold.schichtplaner;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plant die Weckton-Erinnerungen direkt bei Android (wie ein Wecker, AlarmManager.setAlarmClock).
 * Die Liste wird gespeichert, damit sie nach einem Neustart oder App-Update wieder eingeplant werden kann.
 */
public class WakeAlarmScheduler {
    static final String PREFS = "wake_alarms";
    static final String ACTION_WAKE = "de.miragold.schichtplaner.WAKE";
    static final int TEST_ID = 990001;

    /** Ersetzt alle geplanten Wecktöne durch die neue Liste (JSON: [{id, at, title, body}]). */
    static void replaceAll(Context ctx, String alarmsJson, String sound) throws JSONException {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray old = new JSONArray(prefs.getString("alarms", "[]"));
        for (int i = 0; i < old.length(); i++) cancel(ctx, old.getJSONObject(i).getInt("id"));
        prefs.edit().putString("alarms", alarmsJson).putString("sound", sound).apply();
        scheduleStored(ctx);
    }

    /** Plant alle gespeicherten, noch nicht vergangenen Wecktöne (nach Neustart/Update). */
    static void scheduleStored(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String sound = prefs.getString("sound", "app");
        long now = System.currentTimeMillis();
        try {
            JSONArray list = new JSONArray(prefs.getString("alarms", "[]"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.getJSONObject(i);
                long at = Long.parseLong(a.getString("at"));
                if (at > now) set(ctx, a.getInt("id"), at, a.optString("title"), a.optString("body"), sound);
            }
        } catch (JSONException | NumberFormatException e) {
            // kaputte Daten: nichts planen, beim nächsten Öffnen der App wird neu geplant
        }
    }

    static void set(Context ctx, int id, long at, String title, String body, String sound) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = wakeIntent(ctx, id, title, body, sound, PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            // ohne Erlaubnis für exakte Alarme: so genau wie möglich
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            return;
        }
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent show = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
    }

    static void cancel(Context ctx, int id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = wakeIntent(ctx, id, null, null, null, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    private static PendingIntent wakeIntent(Context ctx, int id, String title, String body, String sound, int flags) {
        Intent intent = new Intent(ctx, WakeAlarmReceiver.class);
        intent.setAction(ACTION_WAKE);
        intent.putExtra("id", id);
        if (title != null) intent.putExtra("title", title);
        if (body != null) intent.putExtra("body", body);
        if (sound != null) intent.putExtra("sound", sound);
        return PendingIntent.getBroadcast(ctx, id, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }
}
