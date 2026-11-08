// macOS専用の処理（Windows版の動作には影響しない）
import electron from "electron";
const { app, Menu, shell, ipcMain } = electron;
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { CreateMainWindow, setMacQuitting } from "./windows.js";

//メニューバー・Dock・終了処理などの初期化（app.whenReady後に呼ぶ）
export function setupMacOS() {
  if (process.platform !== "darwin") return;

  //メニューバー（コピー＆ペースト等のショートカットを有効にするため）
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideothers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Speech",
          submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal("https://0quake.github.io/ZeroQuake_Website/");
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  //Dockアイコンのクリックでメイン画面を表示
  app.on("activate", CreateMainWindow);

  //終了処理（ウィンドウを隠さずに閉じる・読み上げを止める）
  app.on("before-quit", () => {
    setMacQuitting(true);
    stopNativeSpeech();
  });

  //「時刻を同期」
  ipcMain.on("open-date-settings", openDateSettings);
}

//macOSの「日付と時刻」設定を開く
function openDateSettings() {
  shell.openExternal("x-apple.systempreferences:com.apple.preference.datetime").catch(() => {
    shell.openPath("/System/Applications/System Settings.app").then((message) => {
      if (message) shell.openPath("/System/Applications/System Preferences.app");
    });
  });
}

//🔴読み上げ（say / afplay）🔴
var nativeSpeechProcess = null;
var nativeSpeechPlaybackProcess = null;
var nativeSpeechToken = 0;

function normalizeNumber(value, min, max, fallback) {
  var num = Number(value);
  if (!Number.isFinite(num)) num = fallback;
  return Math.min(max, Math.max(min, num));
}

export function stopNativeSpeech() {
  nativeSpeechToken++;
  if (nativeSpeechProcess) {
    nativeSpeechProcess.kill();
    nativeSpeechProcess = null;
  }
  if (nativeSpeechPlaybackProcess) {
    nativeSpeechPlaybackProcess.kill();
    nativeSpeechPlaybackProcess = null;
  }
}

export function speakNative(data) {
  if (process.platform !== "darwin") return;

  if (typeof data == "string") data = { text: data };
  if (!data || !data.text) return;

  var text = String(data.text);
  var voice = data.voice ? String(data.voice) : "";
  var voiceCandidates = [];
  if (voice) voiceCandidates.push(voice);
  ["Kyoko", "Otoya"].forEach(function (name) {
    if (!voiceCandidates.includes(name)) voiceCandidates.push(name);
  });
  voiceCandidates.push("");
  var rate = Math.round(200 * normalizeNumber(data.rate, 0.1, 10, 1));
  rate = Math.round(normalizeNumber(rate, 80, 500, 200));
  var volume = normalizeNumber(data.volume, 0, 1, 1);
  if (volume <= 0) {
    stopNativeSpeech();
    return;
  }

  stopNativeSpeech();
  var speechToken = nativeSpeechToken;

  var tmpFile = path.join(
    app.getPath("temp"),
    `zeroquake-tts-${process.pid}-${Date.now()}.aiff`
  );

  function cleanup() {
    fs.unlink(tmpFile, () => {
      return;
    });
  }

  function playGeneratedSpeech() {
    var player = execFile("/usr/bin/afplay", ["-v", String(volume), tmpFile], () => {
      if (speechToken !== nativeSpeechToken) {
        cleanup();
        return;
      }
      if (nativeSpeechPlaybackProcess === player)
        nativeSpeechPlaybackProcess = null;
      cleanup();
    });
    nativeSpeechPlaybackProcess = player;
    player.on("error", cleanup);
  }

  function runSay(voiceIndex) {
    var currentVoice = voiceCandidates[voiceIndex];
    var args = [];
    if (currentVoice) args.push("-v", currentVoice);
    args.push("-r", String(rate), "-o", tmpFile, text);

    var speaker = execFile("/usr/bin/say", args, (error) => {
      if (speechToken !== nativeSpeechToken) {
        cleanup();
        return;
      }
      if (nativeSpeechProcess === speaker) nativeSpeechProcess = null;
      if (error) {
        cleanup();
        if (voiceIndex < voiceCandidates.length - 1) runSay(voiceIndex + 1);
        return;
      }
      playGeneratedSpeech();
    });
    nativeSpeechProcess = speaker;
    speaker.on("error", cleanup);
  }

  runSay(0);
}
