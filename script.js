// --- CONFIGURATION & STATE ---
const METAL_ASSOCIATED_OBJECTS = ["scissors", "knife", "spoon", "fork", "cell phone", "bottle", "wine glass", "cup"];
const CONFIDENCE_THRESHOLD = 0.70;
const DEBOUNCE_TIME_METAL = 500; // ms
const DEBOUNCE_TIME_CLEAR = 1000; // ms

let video, canvas, ctx;
let model = null;
let isDetecting = false;
let detectionInterval = null;

let stateStartTime = Date.now();
let currentSystemState = "CLEAR"; // CLEAR, METAL_DETECTED, ANALYZING
let lastMetalDetectedTime = 0;
let lastClearTime = Date.now();

let totalDetectionsCount = 0;
let clearCountVal = 0;
let alertCountVal = 0;

// --- INITIALIZATION ---
window.addEventListener("DOMContentLoaded", async () => {
    await simulateSystemBoot();
});

async function simulateSystemBoot() {
    const listItems = [
        { id: "init-web", delay: 400 },
        { id: "init-cam", delay: 800 },
        { id: "init-ai", delay: 1500 },
        { id: "init-ard", delay: 400 },
        { id: "init-eng", delay: 500 }
    ];

    for (let item of listItems) {
        const el = document.getElementById(item.id);
        el.className = "pending";
        el.querySelector("i").className = "fa-solid fa-spinner";
        await new Promise(r => setTimeout(r, item.delay));
        el.className = "success";
    }

    document.getElementById("startSystemBtn").disabled = false;
}

function initializeSystem() {
    document.getElementById("initOverlay").style.display = "none";
    video = document.getElementById("webcam");
    canvas = document.getElementById("canvasOverlay");
    ctx = canvas.getContext("2d");
}

// --- CAMERA CONTROLS ---
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            document.getElementById("camStatusBadge").innerText = "ONLINE";
            document.getElementById("camStatusBadge").className = "camera-status active";
            document.getElementById("startCamBtn").disabled = true;
            document.getElementById("stopCamBtn").disabled = false;
            document.getElementById("startDetectBtn").disabled = false;
        };
    } catch (err) {
        alert("Camera permission denied or not available. Please check browser permissions.");
        console.error(err);
    }
}

function stopCamera() {
    if (video && video.srcObject) {
        let tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
    stopDetection();
    document.getElementById("camStatusBadge").innerText = "OFFLINE";
    document.getElementById("camStatusBadge").className = "camera-status";
    document.getElementById("startCamBtn").disabled = false;
    document.getElementById("stopCamBtn").disabled = true;
    document.getElementById("startDetectBtn").disabled = true;
    updateArduinoController("CLEAR", "---", 0);
}

// --- DETECTION ENGINE & AI ---
async function toggleDetection() {
    if (!isDetecting) {
        document.getElementById("startDetectBtn").innerHTML = `<i class="fa-solid fa-eye-slash"></i> STOP DETECTION`;
        document.getElementById("startDetectBtn").className = "btn-action danger";
        isDetecting = true;

        // Load COCO-SSD if not loaded
        if (!model) {
            updateLCD("LOADING MODEL...", "PLEASE WAIT");
            model = await cocoSsd.load();
        }

        detectionInterval = setInterval(runDetectionFrame, 150);
    } else {
        stopDetection();
    }
}

function stopDetection() {
    isDetecting = false;
    if (detectionInterval) clearInterval(detectionInterval);
    document.getElementById("startDetectBtn").innerHTML = `<i class="fa-solid fa-eye"></i> START DETECTION`;
    document.getElementById("startDetectBtn").className = "btn-action accent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateArduinoController("CLEAR", "---", 0);
}

async function runDetectionFrame() {
    if (!isDetecting || !model) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const predictions = await model.detect(video);

    let detectedMetalObj = null;
    let highestConf = 0;

    predictions.forEach(pred => {
        if (METAL_ASSOCIATED_OBJECTS.includes(pred.class.toLowerCase()) && pred.score >= CONFIDENCE_THRESHOLD) {
            if (pred.score > highestConf) {
                highestConf = pred.score;
                detectedMetalObj = pred;
            }
        }

        // Draw bounding boxes for all detected items
        ctx.strokeStyle = METAL_ASSOCIATED_OBJECTS.includes(pred.class.toLowerCase()) ? "#ef4444" : "#06b6d4";
        ctx.lineWidth = 2;
        ctx.strokeRect(pred.bbox[0], pred.bbox[1], pred.bbox[2], pred.bbox[3]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "14px JetBrains Mono";
        ctx.fillText(`${pred.class.toUpperCase()} ${(pred.score * 100).toFixed(1)}%`, pred.bbox[0], pred.bbox[1] > 20 ? pred.bbox[1] - 5 : 15);
    });

    const now = Date.now();
    if (detectedMetalObj) {
        if (currentSystemState !== "METAL_DETECTED") {
            if (now - lastMetalDetectedTime > DEBOUNCE_TIME_METAL) {
                currentSystemState = "METAL_DETECTED";
                totalDetectionsCount++;
                alertCountVal++;
                updateCounters();
                logHistory(detectedMetalObj.class.toUpperCase(), highestConf, "METAL");
            }
        }
        lastMetalDetectedTime = now;
        updateArduinoController("METAL", detectedMetalObj.class.toUpperCase(), highestConf);
    } else {
        if (currentSystemState === "METAL_DETECTED") {
            if (now - lastClearTime > DEBOUNCE_TIME_CLEAR) {
                currentSystemState = "CLEAR";
                clearCountVal++;
                updateCounters();
                logHistory("NO OBJECT", 0, "CLEAR");
            }
        }
        lastClearTime = now;
        updateArduinoController("CLEAR", "---", 0);
    }
}

// --- DIGITAL ARDUINO SIMULATOR & UI UPDATES ---
function updateArduinoController(state, objName, confidence) {
    const mainCard = document.getElementById("mainStatusCard");
    const mainIcon = document.getElementById("mainStatusIcon");
    const mainTitle = document.getElementById("mainStatusTitle");
    const mainSub = document.getElementById("mainStatusSub");
    const objVal = document.getElementById("objectNameVal");
    const timeVal = document.getElementById("timeVal");
    const confVal = document.getElementById("confVal");
    const confProgress = document.getElementById("confProgress");

    const uiRedLed = document.getElementById("uiRedLed");
    const uiGreenLed = document.getElementById("uiGreenLed");
    const stateRedLed = document.getElementById("stateRedLed");
    const stateGreenLed = document.getElementById("stateGreenLed");
    const uiBuzzer = document.getElementById("uiBuzzerIcon");
    const stateBuzzer = document.getElementById("stateBuzzer");

    const currentTimeStr = new Date().toTimeString().split(' ')[0];
    timeVal.innerText = currentTimeStr;
    objVal.innerText = objName;
    confVal.innerText = `${(confidence * 100).toFixed(1)}%`;
    confProgress.style.width = `${confidence * 100}%`;

    if (state === "METAL") {
        mainCard.className = "status-card-large alert-mode";
        mainIcon.innerText = "🔴";
        mainTitle.innerText = "METAL OBJECT DETECTED";
        mainSub.innerText = "SECURITY ALERT ACTIVE";

        uiRedLed.className = "led-indicator red-led active";
        stateRedLed.innerText = "ON";
        stateRedLed.className = "state-badge red";

        uiGreenLed.className = "led-indicator green-led";
        stateGreenLed.innerText = "OFF";
        stateGreenLed.className = "state-badge";

        uiBuzzer.className = "fa-solid fa-volume-high buzzer-icon active";
        stateBuzzer.innerText = "ON";
        stateBuzzer.className = "state-badge red";

        updateLCD("METAL DETECTED", `OBJ: ${objName.substring(0, 8)}`);
    } else {
        mainCard.className = "status-card-large";
        mainIcon.innerText = "🟢";
        mainTitle.innerText = "NO METAL DETECTED";
        mainSub.innerText = "SYSTEM SAFE";

        uiRedLed.className = "led-indicator red-led";
        stateRedLed.innerText = "OFF";
        stateRedLed.className = "state-badge";

        uiGreenLed.className = "led-indicator green-led active";
        stateGreenLed.innerText = "ON";
        stateGreenLed.className = "state-badge green";

        uiBuzzer.className = "fa-solid fa-volume-high buzzer-icon";
        stateBuzzer.innerText = "OFF";
        stateBuzzer.className = "state-badge";

        updateLCD("SYSTEM READY", "NO METAL");
    }
}

function updateLCD(line1, line2) {
    document.getElementById("lcdLine1").innerText = line1.padEnd(16, ' ').substring(0, 16);
    document.getElementById("lcdLine2").innerText = line2.padEnd(16, ' ').substring(0, 16);
}

function updateCounters() {
    document.getElementById("totalCount").innerText = totalDetectionsCount;
    document.getElementById("clearCount").innerText = clearCountVal;
    document.getElementById("alertCount").innerText = alertCountVal;
}

function logHistory(object, confidence, type) {
    const historyList = document.getElementById("historyList");
    if (historyList.querySelector(".history-empty")) {
        historyList.innerHTML = "";
    }

    const timeStr = new Date().toTimeString().split(' ')[0];
    const item = document.createElement("div");
    item.className = `history-item ${type.toLowerCase()}`;
    item.innerHTML = `
        <span>${timeStr} - <strong>${object}</strong> (${(confidence * 100).toFixed(1)}%)</span>
        <span class="state-badge ${type === 'METAL' ? 'red' : 'green'}">${type}</span>
    `;
    historyList.prepend(item);
}

function captureSnapshot() {
    if (!video.srcObject) return;
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = video.videoWidth;
    snapCanvas.height = video.videoHeight;
    const sCtx = snapCanvas.getContext("2d");
    sCtx.drawImage(video, 0, 0);
    const link = document.createElement("a");
    link.download = `detection-${Date.now()}.png`;
    link.href = snapCanvas.toDataURL();
    link.link.click();
}

function togglePresentationMode() {
    document.body.classList.toggle("presentation-mode");
    const btn = document.getElementById("presentationBtn");
    if (document.body.classList.contains("presentation-mode")) {
        btn.innerHTML = `<i class="fa-solid fa-compress"></i> EXIT PRESENTATION`;
    } else {
        btn.innerHTML = `<i class="fa-solid fa-expand"></i> PRESENTATION MODE`;
    }
}