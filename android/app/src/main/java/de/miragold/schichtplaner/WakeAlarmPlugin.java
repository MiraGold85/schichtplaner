package de.miragold.schichtplaner;

import android.app.AlarmManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Schnittstelle für app.js: Wecktöne planen (schedule) und testen (test). */
@CapacitorPlugin(name = "WakeAlarm")
public class WakeAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray alarms = call.getArray("alarms", new JSArray());
        String sound = call.getString("sound", "app");
        try {
            WakeAlarmScheduler.replaceAll(getContext(), alarms.toString(), sound);
            call.resolve();
        } catch (Exception e) {
            call.reject("Wecktöne konnten nicht geplant werden: " + e.getMessage());
        }
    }

    /** Diagnose: Wecker-Lautstärke, Erlaubnis für exakte Alarme, nächster/letzter Weckton. */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        AlarmManager alarms = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences p = ctx.getSharedPreferences(WakeAlarmScheduler.PREFS, Context.MODE_PRIVATE);
        JSObject r = new JSObject();
        r.put("alarmVolume", am != null ? am.getStreamVolume(AudioManager.STREAM_ALARM) : -1);
        r.put("alarmMax", am != null ? am.getStreamMaxVolume(AudioManager.STREAM_ALARM) : -1);
        r.put("ringerMode", am != null ? am.getRingerMode() : -1);
        r.put("canExact", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (alarms != null && alarms.canScheduleExactAlarms()));
        AlarmManager.AlarmClockInfo next = alarms != null ? alarms.getNextAlarmClock() : null;
        r.put("nextAlarmClock", next != null ? String.valueOf(next.getTriggerTime()) : "");
        r.put("lastFired", p.getString("lastFired", ""));
        r.put("lastResult", p.getString("lastResult", ""));
        call.resolve(r);
    }

    /** Weckton sofort abspielen – zum Ausprobieren, ob er bei lautlos durchkommt. */
    @PluginMethod
    public void playNow(PluginCall call) {
        WakeAlarmReceiver.playSound(getContext(), call.getString("sound", "app"), null);
        call.resolve();
    }

    /** Zeigt den Lautstärkeregler für den Wecker an. */
    @PluginMethod
    public void showAlarmVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) am.adjustStreamVolume(AudioManager.STREAM_ALARM, AudioManager.ADJUST_SAME, AudioManager.FLAG_SHOW_UI);
        call.resolve();
    }

    @PluginMethod
    public void test(PluginCall call) {
        try {
            long at = Long.parseLong(call.getString("at"));
            WakeAlarmScheduler.set(getContext(), WakeAlarmScheduler.TEST_ID, at,
                    call.getString("title", "Schichtplaner – Test"), call.getString("body", ""), call.getString("sound", "app"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Test-Weckton konnte nicht geplant werden: " + e.getMessage());
        }
    }
}
