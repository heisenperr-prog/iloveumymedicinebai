
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <RTClib.h>
#include <Preferences.h>
#include <ESP32Servo.h>
#include <DFRobotDFPlayerMini.h>
#include <time.h>

// ========================================
// WIFI
// ========================================

const char* ssid = "RTX 4090 ULTRA PRO MAX";
const char* password = "01072004";

WebServer server(80);

// ========================================
// RTC AND STORAGE
// ========================================

RTC_DS3231 rtc;
Preferences preferences;

bool rtcReady = false;
bool rtcTimeValid = false;
bool ntpSynced = false;

unsigned long lastNtpAttempt = 0;

const unsigned long NTP_RETRY_MS = 60000UL;
const unsigned long NTP_RESYNC_MS = 21600000UL;

// ========================================
// PIN CONFIGURATION
// ========================================

#define SERVO1_PIN 19
#define SERVO2_PIN 18

#define REED1_PIN 25
#define REED2_PIN 26

#define BUTTON_PIN 27

#define LED1_PIN 32
#define LED2_PIN 33

#define MP3_RX 16
#define MP3_TX 17



// =====================================================
// SERVO CONFIGURATION - SMOOTH MOVEMENT
// =====================================================

Servo servo1;
Servo servo2;

#define SERVO1_PIN 18
#define SERVO2_PIN 19

#define SERVO1_CLOSE_ANGLE 180
#define SERVO1_OPEN_ANGLE 10

#define SERVO2_CLOSE_ANGLE 180
#define SERVO2_OPEN_ANGLE 10

// 3000 milliseconds = 3 seconds
const unsigned long SERVO_OPEN_DURATION = 2000;
const unsigned long SERVO_CLOSE_DURATION = 500;

// Current and target positions
int servo1CurrentAngle = SERVO1_CLOSE_ANGLE;
int servo2CurrentAngle = SERVO2_CLOSE_ANGLE;

int servo1TargetAngle = SERVO1_CLOSE_ANGLE;
int servo2TargetAngle = SERVO2_CLOSE_ANGLE;

// Smooth movement variables
int servo1StartAngle = SERVO1_CLOSE_ANGLE;
int servo2StartAngle = SERVO2_CLOSE_ANGLE;

int servo1PreviousTarget = SERVO1_CLOSE_ANGLE;
int servo2PreviousTarget = SERVO2_CLOSE_ANGLE;

unsigned long servo1MoveStart = 0;
unsigned long servo2MoveStart = 0;

unsigned long servo1MoveDuration = 3000;
unsigned long servo2MoveDuration = 3000;

bool servo1Moving = false;
bool servo2Moving = false;

// ========================================
// MP3
// ========================================

HardwareSerial MP3Serial(2);
DFRobotDFPlayerMini mp3;

bool mp3Ready = false;

#define AUDIO_REMINDER 1
#define AUDIO_DUE 2
#define AUDIO_WRONG 3

#define ALERT_DURATION 60000UL

int currentTrack = 0;
unsigned long audioStartedAt = 0;

// ========================================
// MEDICINE SETTINGS
// ========================================

String medicine1Name = "Medicine 1";
String medicine2Name = "Medicine 2";

int medicine1Hour = 11;
int medicine1Minute = 8;

int medicine2Hour = 11;
int medicine2Minute = 20;

bool medicine1Active = false;
bool medicine2Active = false;

bool medicine1Completed = false;
bool medicine2Completed = false;

bool schedule1Triggered = false;
bool schedule2Triggered = false;

unsigned long medicine1Start = 0;
unsigned long medicine2Start = 0;

int lastDateKey = -1;

// ========================================
// REED SWITCHES
// LOW = CLOSED
// HIGH = OPEN
// ========================================

bool reed1Open = false;
bool reed2Open = false;

bool lastReed1Open = false;
bool lastReed2Open = false;

unsigned long reed1ChangedAt = 0;
unsigned long reed2ChangedAt = 0;

const unsigned long REED_DEBOUNCE = 50;

// ========================================
// WRONG COMPARTMENT ALERT
// ========================================

bool wrongAlertActive = false;

// 0 = none
// 1 = compartment 1
// 2 = compartment 2

int wrongCompartment = 0;

// ========================================
// BUTTON
// ========================================

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

unsigned long buttonChangedAt = 0;

const unsigned long BUTTON_DEBOUNCE = 40;

// ========================================
// SYSTEM
// ========================================

String lastEvent = "System started";

String twoDigits(int n) {
  return n < 10 ? "0" + String(n) : String(n);
}

void logEvent(String message) {
  lastEvent = message;

  Serial.print("[EVENT] ");
  Serial.println(message);
}

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "");

  return value;
}

void sendCors() {
  server.sendHeader(
    "Access-Control-Allow-Origin", "*"
  );

  server.sendHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  server.sendHeader(
    "Access-Control-Allow-Headers", "*"
  );
}

void sendText(int status, String message) {
  sendCors();
  server.send(status, "text/plain", message);
}

// ========================================
// RTC PHILIPPINE TIME SYNCHRONIZATION
// ========================================

bool syncRtcPhilippineTime() {

  if (!rtcReady) {
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("NTP unavailable: WiFi disconnected.");
    return false;
  }

  Serial.println();
  Serial.println("SYNCING RTC WITH PHILIPPINE TIME...");

  // Philippines = UTC+8, no daylight saving.

  configTime(
    8 * 3600,
    0,
    "pool.ntp.org",
    "time.google.com",
    "time.cloudflare.com"
  );

  struct tm localTime;

  if (!getLocalTime(&localTime, 10000)) {
    Serial.println("NTP synchronization FAILED!");
    Serial.println("Will retry automatically.");
    return false;
  }

  int year = localTime.tm_year + 1900;
  int month = localTime.tm_mon + 1;
  int day = localTime.tm_mday;

  int hour = localTime.tm_hour;
  int minute = localTime.tm_min;
  int second = localTime.tm_sec;

  if (year < 2024 || year > 2099) {
    Serial.println("Invalid NTP date received!");
    return false;
  }

  DateTime philippineTime(
    year,
    month,
    day,
    hour,
    minute,
    second
  );

  // Update physical DS3231.

  rtc.adjust(philippineTime);

  rtcTimeValid = true;
  ntpSynced = true;

  Serial.println("NTP TIME RECEIVED!");
  Serial.println("DS3231 UPDATED!");
  Serial.println("RTC synchronization SUCCESS!");

  Serial.print("Philippine Date: ");

  Serial.print(year);
  Serial.print("-");
  Serial.print(twoDigits(month));
  Serial.print("-");
  Serial.println(twoDigits(day));

  Serial.print("Philippine Time: ");

  Serial.print(twoDigits(hour));
  Serial.print(":");
  Serial.print(twoDigits(minute));
  Serial.print(":");
  Serial.println(twoDigits(second));

  return true;
}

// ========================================
// AUDIO FUNCTIONS
// ========================================

void playTrack(int track) {

  if (!mp3Ready) return;

  if (currentTrack == track) return;

  mp3.stop();
  delay(120);

  while (mp3.available()) {
    mp3.readType();
    mp3.read();
  }

  mp3.playMp3Folder(track);

  currentTrack = track;
  audioStartedAt = millis();

  Serial.print("[AUDIO] Playing ");
  Serial.println(track);
}

void stopAudio() {

  if (mp3Ready) {
    mp3.stop();
  }

  currentTrack = 0;
}

// ========================================
// DETERMINE MEDICINE AUDIO
// ========================================

int getMedicineAudio() {

  bool active =
    medicine1Active || medicine2Active;

  if (!active) return 0;

  if (
    medicine1Active &&
    millis() - medicine1Start < ALERT_DURATION
  ) {
    return AUDIO_DUE;
  }

  if (
    medicine2Active &&
    millis() - medicine2Start < ALERT_DURATION
  ) {
    return AUDIO_DUE;
  }

  return AUDIO_REMINDER;
}

// ========================================
// AUDIO PRIORITY
// ========================================

void updateAudio() {

  // Wrong compartment has highest priority.

  if (wrongAlertActive) {
    playTrack(AUDIO_WRONG);
    return;
  }

  int requiredTrack = getMedicineAudio();

  if (requiredTrack == 0) {

    if (currentTrack != 0) {
      stopAudio();
    }

    return;
  }

  playTrack(requiredTrack);
}

// ========================================
// REPEAT FINISHED AUDIO
// ========================================

void processAudio() {

  if (!mp3Ready) return;

  while (mp3.available()) {

    uint8_t type = mp3.readType();
    int value = mp3.read();

    if (type != DFPlayerPlayFinished) {
      continue;
    }

    if (value != currentTrack) continue;

    if (millis() - audioStartedAt < 300) {
      continue;
    }

    if (currentTrack == AUDIO_WRONG) {

      if (wrongAlertActive) {

        mp3.playMp3Folder(AUDIO_WRONG);
        audioStartedAt = millis();

        Serial.println(
          "[AUDIO] Repeating wrong compartment warning"
        );
      }
    }

    else if (currentTrack == AUDIO_REMINDER) {

      if (
        !wrongAlertActive &&
        (medicine1Active || medicine2Active)
      ) {

        mp3.playMp3Folder(AUDIO_REMINDER);
        audioStartedAt = millis();

        Serial.println(
          "[AUDIO] Repeating medicine reminder"
        );
      }
    }

    else if (currentTrack == AUDIO_DUE) {

      if (
        !wrongAlertActive &&
        getMedicineAudio() == AUDIO_DUE
      ) {

        mp3.playMp3Folder(AUDIO_DUE);
        audioStartedAt = millis();
      }
    }
  }
}


// ========================================
// POSITIONAL SERVO FUNCTIONS
// ========================================

// Compatibility functions.
// Retained so other parts of the main code
// will not produce undeclared-function errors.

void stopServo1() {
  // No STOP command is needed for positional servos.
  // The servo holds its last commanded angle.
}

void stopServo2() {
  // No STOP command is needed for positional servos.
}

// ========================================
// OPEN MEDICINE COMPARTMENTS
// ========================================
// =====================================
// OPEN / CLOSE COMMANDS
// =====================================

void openMedicine1() {
  servo1TargetAngle = SERVO1_OPEN_ANGLE;
}

void closeMedicine1() {
  servo1TargetAngle = SERVO1_CLOSE_ANGLE;
}

void openMedicine2() {
  servo2TargetAngle = SERVO2_OPEN_ANGLE;
}

void closeMedicine2() {
  servo2TargetAngle = SERVO2_CLOSE_ANGLE;
}

// =====================================
// SLOW NON-BLOCKING SERVO MOVEMENT
// =====================================


void processServos() {

  unsigned long now = millis();

  // =====================================================
  // SERVO 1 - DETECT NEW TARGET
  // =====================================================

  if (servo1TargetAngle != servo1PreviousTarget) {

    servo1PreviousTarget = servo1TargetAngle;

    servo1StartAngle = servo1CurrentAngle;

    servo1MoveStart = now;

    servo1MoveDuration =
      (servo1TargetAngle == SERVO1_OPEN_ANGLE)
      ? SERVO_OPEN_DURATION
      : SERVO_CLOSE_DURATION;

    servo1Moving =
      (servo1CurrentAngle != servo1TargetAngle);
  }

  // =====================================================
  // SERVO 1 - SMOOTH MOVEMENT
  // =====================================================

  if (servo1Moving) {

    unsigned long elapsed = now - servo1MoveStart;

    if (elapsed >= servo1MoveDuration) {

      servo1CurrentAngle = servo1TargetAngle;

      servo1.write(servo1CurrentAngle);

      servo1Moving = false;

    } else {

      float progress =
        (float)elapsed / (float)servo1MoveDuration;

      // Smoothstep easing
      // Slow start -> smooth middle -> slow stop
      progress =
        progress * progress * (3.0f - 2.0f * progress);

      int newAngle = round(
        servo1StartAngle +
        (servo1TargetAngle - servo1StartAngle) * progress
      );

      newAngle = constrain(newAngle, 0, 180);

      if (newAngle != servo1CurrentAngle) {

        servo1CurrentAngle = newAngle;

        servo1.write(servo1CurrentAngle);
      }
    }
  }

  // =====================================================
  // SERVO 2 - DETECT NEW TARGET
  // =====================================================

  if (servo2TargetAngle != servo2PreviousTarget) {

    servo2PreviousTarget = servo2TargetAngle;

    servo2StartAngle = servo2CurrentAngle;

    servo2MoveStart = now;

    servo2MoveDuration =
      (servo2TargetAngle == SERVO2_OPEN_ANGLE)
      ? SERVO_OPEN_DURATION
      : SERVO_CLOSE_DURATION;

    servo2Moving =
      (servo2CurrentAngle != servo2TargetAngle);
  }

  // =====================================================
  // SERVO 2 - SMOOTH MOVEMENT
  // =====================================================

  if (servo2Moving) {

    unsigned long elapsed = now - servo2MoveStart;

    if (elapsed >= servo2MoveDuration) {

      servo2CurrentAngle = servo2TargetAngle;

      servo2.write(servo2CurrentAngle);

      servo2Moving = false;

    } else {

      float progress =
        (float)elapsed / (float)servo2MoveDuration;

      // Smoothstep easing
      // Slow start -> smooth middle -> slow stop
      progress =
        progress * progress * (3.0f - 2.0f * progress);

      int newAngle = round(
        servo2StartAngle +
        (servo2TargetAngle - servo2StartAngle) * progress
      );

      newAngle = constrain(newAngle, 0, 180);

      if (newAngle != servo2CurrentAngle) {

        servo2CurrentAngle = newAngle;

        servo2.write(servo2CurrentAngle);
      }
    }
  }
}

// ========================================
// START MEDICINE REMINDERS
// ========================================

void startMedicine1() {

  if (medicine1Active || medicine1Completed) {
    return;
  }

  medicine1Active = true;
  medicine1Start = millis();

  digitalWrite(LED1_PIN, HIGH);

  openMedicine1();

  logEvent(medicine1Name + " is DUE");

  updateAudio();
}

void startMedicine2() {

  if (medicine2Active || medicine2Completed) {
    return;
  }

  medicine2Active = true;
  medicine2Start = millis();

  digitalWrite(LED2_PIN, HIGH);

  openMedicine2();

  logEvent(medicine2Name + " is DUE");

  updateAudio();
}

// ========================================
// WRONG COMPARTMENT DETECTION
// ========================================

int detectWrongCompartment() {

  // If both medicines are active,
  // both compartments are permitted.

  if (medicine1Active && medicine2Active) {
    return 0;
  }

  // Medicine 1 is due.
  // Compartment 2 must remain closed.

  if (medicine1Active && reed2Open) {
    return 2;
  }

  // Medicine 2 is due.
  // Compartment 1 must remain closed.

  if (medicine2Active && reed1Open) {
    return 1;
  }

  return 0;
}

void startWrongAlert(int compartment) {

  if (
    wrongAlertActive &&
    wrongCompartment == compartment
  ) {
    return;
  }

  wrongAlertActive = true;
  wrongCompartment = compartment;

  Serial.println();
  Serial.println("============================");
  Serial.println("WRONG COMPARTMENT ALERT!");

  Serial.print("Wrong compartment: ");
  Serial.println(compartment);

  Serial.println("Close the compartment!");
  Serial.println("============================");

  logEvent(
    "Wrong compartment " +
    String(compartment) +
    " opened"
  );

  updateAudio();
}

void stopWrongAlert() {

  if (!wrongAlertActive) return;

  wrongAlertActive = false;
  wrongCompartment = 0;

  stopAudio();

  logEvent(
    "Wrong compartment closed - warning stopped"
  );

  updateAudio();
}

void updateWrongAlert() {

  int detectedWrong = detectWrongCompartment();

  if (detectedWrong != 0) {
    startWrongAlert(detectedWrong);
  } else {
    stopWrongAlert();
  }
}

// ========================================
// REED SWITCH MONITORING
// ========================================

void processReeds() {

  unsigned long now = millis();

  bool reading1 =
    digitalRead(REED1_PIN) == HIGH;

  bool reading2 =
    digitalRead(REED2_PIN) == HIGH;

  // Debounce reed 1.

  if (reading1 != lastReed1Open) {

    reed1ChangedAt = now;
    lastReed1Open = reading1;
  }

  if (
    now - reed1ChangedAt >= REED_DEBOUNCE &&
    reed1Open != reading1
  ) {

    reed1Open = reading1;

    logEvent(
      reed1Open ?
      "Compartment 1 physically OPEN" :
      "Compartment 1 physically CLOSED"
    );
  }

  // Debounce reed 2.

  if (reading2 != lastReed2Open) {

    reed2ChangedAt = now;
    lastReed2Open = reading2;
  }

  if (
    now - reed2ChangedAt >= REED_DEBOUNCE &&
    reed2Open != reading2
  ) {

    reed2Open = reading2;

    logEvent(
      reed2Open ?
      "Compartment 2 physically OPEN" :
      "Compartment 2 physically CLOSED"
    );
  }

  updateWrongAlert();
}

// ========================================
// ACKNOWLEDGMENT
// ========================================

void confirmMedicine1() {

  if (!medicine1Active) return;

  medicine1Active = false;
  medicine1Completed = true;

  digitalWrite(LED1_PIN, LOW);

  closeMedicine1();

  logEvent(medicine1Name + " acknowledged");

  updateWrongAlert();
  updateAudio();
}

void confirmMedicine2() {

  if (!medicine2Active) return;

  medicine2Active = false;
  medicine2Completed = true;

  digitalWrite(LED2_PIN, LOW);

  closeMedicine2();

  logEvent(medicine2Name + " acknowledged");

  updateWrongAlert();
  updateAudio();
}

void acknowledgeMedicine() {

  // Wrong compartment must be closed first.

  if (wrongAlertActive) {

    logEvent(
      "Close wrong compartment before acknowledgment"
    );

    return;
  }

  if (medicine1Active) {
    confirmMedicine1();
  }

  else if (medicine2Active) {
    confirmMedicine2();
  }
}

// ========================================
// BUTTON
// ========================================

void processButton() {

  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {

    buttonChangedAt = millis();
    lastButtonReading = reading;
  }

  if (
    millis() - buttonChangedAt >= BUTTON_DEBOUNCE &&
    reading != stableButtonState
  ) {

    stableButtonState = reading;

    if (stableButtonState == LOW) {
      acknowledgeMedicine();
    }
  }
}

// ========================================
// RTC SCHEDULE
// ========================================

void processSchedule() {

  // Do not trigger schedules using invalid RTC time.

  if (!rtcReady || !rtcTimeValid) return;

  DateTime now = rtc.now();

  int dateKey =
    now.year() * 10000 +
    now.month() * 100 +
    now.day();

  if (dateKey != lastDateKey) {

    lastDateKey = dateKey;

    schedule1Triggered = false;
    schedule2Triggered = false;

    // Keep unfinished active alerts active.

    if (!medicine1Active) {
      medicine1Completed = false;
    }

    if (!medicine2Active) {
      medicine2Completed = false;
    }

    logEvent("Daily schedules reset");
  }

  if (
    now.hour() == medicine1Hour &&
    now.minute() == medicine1Minute &&
    !schedule1Triggered
  ) {

    schedule1Triggered = true;
    startMedicine1();
  }

  if (
    now.hour() == medicine2Hour &&
    now.minute() == medicine2Minute &&
    !schedule2Triggered
  ) {

    schedule2Triggered = true;
    startMedicine2();
  }
}

// ========================================
// API STATUS
// ========================================


void handleStatus() {

  String currentTime = "--:--:--";
  String currentDate = "---- -- --";

  if (rtcReady && rtcTimeValid) {
    DateTime now = rtc.now();

    currentTime =
      twoDigits(now.hour()) + ":" +
      twoDigits(now.minute()) + ":" +
      twoDigits(now.second());

    currentDate =
      String(now.year()) + "-" +
      twoDigits(now.month()) + "-" +
      twoDigits(now.day());
  }

  String med1Status =
    medicine1Active ? "DUE" :
    medicine1Completed ? "TAKEN" : "WAITING";

  String med2Status =
    medicine2Active ? "DUE" :
    medicine2Completed ? "TAKEN" : "WAITING";

  // =====================================
  // SERVO COMMAND STATUS
  // =====================================

  String servo1Status;

  if (servo1Moving) {
    servo1Status =
      servo1TargetAngle == SERVO1_OPEN_ANGLE
      ? "OPENING" : "CLOSING";
  } else {
    servo1Status =
      servo1TargetAngle == SERVO1_OPEN_ANGLE
      ? "OPEN" : "CLOSED";
  }

  String servo2Status;

  if (servo2Moving) {
    servo2Status =
      servo2TargetAngle == SERVO2_OPEN_ANGLE
      ? "OPENING" : "CLOSING";
  } else {
    servo2Status =
      servo2TargetAngle == SERVO2_OPEN_ANGLE
      ? "OPEN" : "CLOSED";
  }

  // =====================================
  // LED OUTPUT STATUS
  // =====================================

  bool led1On = digitalRead(LED1_PIN) == HIGH;
  bool led2On = digitalRead(LED2_PIN) == HIGH;

  // =====================================
  // JSON RESPONSE
  // =====================================

  String json = "{";

  json += "\"time\":\"" + currentTime + "\",";
  json += "\"date\":\"" + currentDate + "\",";

  json += "\"rtc\":\"";
  json += (rtcReady && rtcTimeValid) ? "ACTIVE" : "ERROR";
  json += "\",";

  json += "\"wifi\":\"";
  json += WiFi.status() == WL_CONNECTED
          ? "CONNECTED" : "DISCONNECTED";
  json += "\",";

  json += "\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\",";

  // =====================================
  // MEDICINE 1
  // =====================================

  json += "\"med1\":{";

  json += "\"name\":\"";
  json += jsonEscape(medicine1Name);
  json += "\",";

  json += "\"hour\":";
  json += String(medicine1Hour);
  json += ",";

  json += "\"minute\":";
  json += String(medicine1Minute);
  json += ",";

  json += "\"schedule\":\"";
  json += twoDigits(medicine1Hour) + ":" +
          twoDigits(medicine1Minute);
  json += "\",";

  json += "\"status\":\"";
  json += med1Status;
  json += "\",";

  json += "\"compartment\":\"";
  json += reed1Open ? "OPEN" : "CLOSED";
  json += "\",";

  json += "\"reed\":";
  json += reed1Open ? "true" : "false";
  json += ",";

  json += "\"servo\":\"";
  json += servo1Status;
  json += "\",";

  json += "\"led\":";
  json += led1On ? "true" : "false";

  json += "},";

  // =====================================
  // MEDICINE 2
  // =====================================

  json += "\"med2\":{";

  json += "\"name\":\"";
  json += jsonEscape(medicine2Name);
  json += "\",";

  json += "\"hour\":";
  json += String(medicine2Hour);
  json += ",";

  json += "\"minute\":";
  json += String(medicine2Minute);
  json += ",";

  json += "\"schedule\":\"";
  json += twoDigits(medicine2Hour) + ":" +
          twoDigits(medicine2Minute);
  json += "\",";

  json += "\"status\":\"";
  json += med2Status;
  json += "\",";

  json += "\"compartment\":\"";
  json += reed2Open ? "OPEN" : "CLOSED";
  json += "\",";

  json += "\"reed\":";
  json += reed2Open ? "true" : "false";
  json += ",";

  json += "\"servo\":\"";
  json += servo2Status;
  json += "\",";

  json += "\"led\":";
  json += led2On ? "true" : "false";

  json += "},";

  // =====================================
  // ALERTS
  // =====================================

  json += "\"alarm\":";

  json += (
    medicine1Active ||
    medicine2Active ||
    wrongAlertActive
  ) ? "true" : "false";

  json += ",";

  json += "\"wrongAlert\":";
  json += wrongAlertActive ? "true" : "false";

  json += ",";

  json += "\"wrongCompartment\":";
  json += String(wrongCompartment);

  json += ",";

  json += "\"lastEvent\":\"";
  json += jsonEscape(lastEvent);
  json += "\"";

  json += "}";

  sendCors();

  server.send(
    200,
    "application/json",
    json
  );
}

// ========================================
// API: UPDATE SCHEDULE
// ========================================

void handleSetMedicine() {

  if (
    !server.hasArg("med") ||
    !server.hasArg("name") ||
    !server.hasArg("hour") ||
    !server.hasArg("minute")
  ) {

    sendText(400, "Missing parameters");
    return;
  }

  int med = server.arg("med").toInt();

  String name = server.arg("name");
  name.trim();

  String hourText = server.arg("hour");
  String minuteText = server.arg("minute");

  int hour = hourText.toInt();
  int minute = minuteText.toInt();

  if (med != 1 && med != 2) {

    sendText(400, "Invalid medicine");
    return;
  }

  if (name.length() == 0 || name.length() > 40) {

    sendText(400, "Invalid medicine name");
    return;
  }

  for (unsigned int i = 0; i < hourText.length(); i++) {

    if (!isDigit(hourText[i])) {

      sendText(400, "Invalid hour");
      return;
    }
  }

  for (unsigned int i = 0; i < minuteText.length(); i++) {

    if (!isDigit(minuteText[i])) {

      sendText(400, "Invalid minute");
      return;
    }
  }

  if (
    hourText.length() == 0 ||
    minuteText.length() == 0 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {

    sendText(400, "Invalid schedule time");
    return;
  }

  if (med == 1) {

    if (medicine1Active) {

      sendText(409, "Medicine 1 alert is active");
      return;
    }

    medicine1Name = name;
    medicine1Hour = hour;
    medicine1Minute = minute;

    preferences.putString("med1name", name);
    preferences.putInt("med1hour", hour);
    preferences.putInt("med1min", minute);

    schedule1Triggered = false;
    medicine1Completed = false;

    logEvent("Medicine 1 schedule updated");
  }

  else {

    if (medicine2Active) {

      sendText(409, "Medicine 2 alert is active");
      return;
    }

    medicine2Name = name;
    medicine2Hour = hour;
    medicine2Minute = minute;

    preferences.putString("med2name", name);
    preferences.putInt("med2hour", hour);
    preferences.putInt("med2min", minute);

    schedule2Triggered = false;
    medicine2Completed = false;

    logEvent("Medicine 2 schedule updated");
  }

  sendText(200, "Schedule saved successfully!");
}

// ========================================
// API: ACKNOWLEDGE
// ========================================

void handleAcknowledge() {

  if (wrongAlertActive) {

    sendText(
      409,
      "Close the wrong compartment first"
    );

    return;
  }

  if (!medicine1Active && !medicine2Active) {

    sendText(200, "No active medicine alert");
    return;
  }

  acknowledgeMedicine();

  sendText(200, "Medicine acknowledged");
}

// ========================================
// API: TEST MEDICINE
// ========================================

void handleTestMedicine() {

  if (!server.hasArg("med")) {

    sendText(400, "Missing medicine number");
    return;
  }

  int med = server.arg("med").toInt();

  if (med == 1) {

    if (medicine1Active || medicine1Completed) {

      sendText(
        409,
        "Medicine 1 already active or completed"
      );

      return;
    }

    startMedicine1();
  }

  else if (med == 2) {

    if (medicine2Active || medicine2Completed) {

      sendText(
        409,
        "Medicine 2 already active or completed"
      );

      return;
    }

    startMedicine2();
  }

  else {

    sendText(400, "Invalid medicine number");
    return;
  }

  sendText(200, "Medicine test started");
}

// ========================================
// SETUP
// ========================================

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println();

  Serial.println("==========================");
  Serial.println("SMART MEDICINE BOX");
  Serial.println("WITH WRONG COMPARTMENT ALERT");
  Serial.println("==========================");

  // GPIO

  pinMode(LED1_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(REED1_PIN, INPUT_PULLUP);
  pinMode(REED2_PIN, INPUT_PULLUP);

  digitalWrite(LED1_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);

  // Read initial reed states.

  reed1Open = digitalRead(REED1_PIN) == HIGH;
  reed2Open = digitalRead(REED2_PIN) == HIGH;

  lastReed1Open = reed1Open;
  lastReed2Open = reed2Open;

  // =====================================
  // RTC INITIALIZATION
  // =====================================

  Wire.begin(21, 22);

  rtcReady = rtc.begin();

  if (rtcReady) {

    Serial.println("RTC DETECTED!");

    rtcTimeValid = !rtc.lostPower();

    if (!rtcTimeValid) {

      Serial.println(
        "WARNING: RTC lost power. NTP sync required."
      );

    } else {

      Serial.println(
        "RTC backup time available."
      );
    }

  } else {

    rtcTimeValid = false;

    Serial.println("RTC NOT DETECTED!");
  }

  // =====================================
  // PREFERENCES
  // =====================================

  preferences.begin("medicinebox", false);

  medicine1Name =
    preferences.getString("med1name", "Medicine 1");

  medicine1Hour =
    preferences.getInt("med1hour", 11);

  medicine1Minute =
    preferences.getInt("med1min", 8);

  medicine2Name =
    preferences.getString("med2name", "Medicine 2");

  medicine2Hour =
    preferences.getInt("med2hour", 11);

  medicine2Minute =
    preferences.getInt("med2min", 20);

  // =====================================
  // SERVOS
  // =====================================

 
servo1.setPeriodHertz(50);
servo2.setPeriodHertz(50);

servo1.attach(SERVO1_PIN, 1000, 2000);
servo2.attach(SERVO2_PIN, 1000, 2000);

// Set initial positions.
servo1.write(SERVO1_CLOSE_ANGLE);
servo2.write(SERVO2_CLOSE_ANGLE);

  // =====================================
  // MP3
  // =====================================

  MP3Serial.begin(
    9600,
    SERIAL_8N1,
    MP3_RX,
    MP3_TX
  );

  delay(1200);

  if (mp3.begin(MP3Serial)) {

    mp3Ready = true;

    mp3.volume(30);

    Serial.println("MP3 READY!");

  } else {

    Serial.println("MP3 NOT DETECTED!");
  }

  // =====================================
  // WIFI CONNECTION
  // =====================================

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");

  unsigned long wifiStart = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - wifiStart < 15000
  ) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("WiFi CONNECTED!");

    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println(
      "WiFi unavailable. Local medicine functions continue."
    );
  }

  // =====================================
  // AUTOMATIC RTC NTP SYNC
  // =====================================

  if (rtcReady) {

    lastNtpAttempt = millis();

    if (syncRtcPhilippineTime()) {

      lastDateKey = -1;

    } else if (!rtcTimeValid) {

      Serial.println(
        "RTC TIME INVALID: schedules paused until NTP sync."
      );
    }
  }

  // =====================================
  // SCADA API ROUTES
  // =====================================

  server.on(
    "/api/status",
    HTTP_GET,
    handleStatus
  );

  server.on(
    "/api/set",
    HTTP_GET,
    handleSetMedicine
  );

  server.on(
    "/set",
    HTTP_GET,
    handleSetMedicine
  );

  server.on(
    "/api/ack",
    HTTP_GET,
    handleAcknowledge
  );

  server.on(
    "/api/test",
    HTTP_GET,
    handleTestMedicine
  );

  server.onNotFound([]() {

    if (server.method() == HTTP_OPTIONS) {

      sendCors();
      server.send(204, "text/plain", "");
      return;
    }

    sendText(404, "Endpoint not found");
  });

  server.begin();

  Serial.println("SCADA API SERVER STARTED!");
  Serial.println("SYSTEM READY!");
}

// ========================================
// MAIN LOOP
// ========================================

void loop() {

  // Retry NTP every minute until successful.
  // Once synchronized, refresh every 6 hours.

  unsigned long retryInterval =
    ntpSynced ? NTP_RESYNC_MS : NTP_RETRY_MS;

  if (
    rtcReady &&
    WiFi.status() == WL_CONNECTED &&
    millis() - lastNtpAttempt >= retryInterval
  ) {

    lastNtpAttempt = millis();

    if (syncRtcPhilippineTime()) {
      lastDateKey = -1;
    }
  }

  server.handleClient();

  processSchedule();

  processServos();

  processReeds();

  processButton();

  updateAudio();

  processAudio();

  delay(5);
}
