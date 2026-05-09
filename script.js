const APP_VERSION = "1.1.2";



const STORAGE_KEY = "smart-electricity-tracker-readings";
const COST_STORAGE_KEY = "smart-electricity-tracker-cost-per-unit";

const form = document.getElementById("reading-form");
const readingInput = document.getElementById("meter-reading");
const messageElement = document.getElementById("form-message");
const todayUsageElement = document.getElementById("today-usage");
const weeklyUsageElement = document.getElementById("weekly-usage");
const monthlyUsageElement = document.getElementById("monthly-usage");
const totalUsageElement = document.getElementById("total-usage");
const historyListElement = document.getElementById("history-list");

const costPerUnitInput = document.getElementById("cost-per-unit");
const weeklyBillElement = document.getElementById("weekly-bill");
const monthlyBillElement = document.getElementById("monthly-bill");
const totalBillElement = document.getElementById("total-bill");
const exportButton = document.getElementById("export-button");

const weekChartButton = document.getElementById("week-chart-button");
const monthChartButton = document.getElementById("month-chart-button");
const usageChartCanvas = document.getElementById("usage-chart");
const chartEmptyElement = document.getElementById("chart-empty");

const openScannerButton = document.getElementById("open-scanner");
const closeScannerButton = document.getElementById("close-scanner");
const scannerModal = document.getElementById("scanner-modal");
const cameraPreview = document.getElementById("camera-preview");
const capturePreview = document.getElementById("capture-preview");
const captureButton = document.getElementById("capture-button");
const useReadingButton = document.getElementById("use-reading-button");
const retakeButton = document.getElementById("retake-button");
const scannerStatusElement = document.getElementById("scanner-status");
const scannerLoadingElement = document.getElementById("scanner-loading");
const ocrResultElement = document.getElementById("ocr-result");
const ocrConfidenceElement = document.getElementById("ocr-confidence");
const scannerPassSummaryElement = document.getElementById("scanner-pass-summary");
const guideBox = document.getElementById("guide-box");
const cropPreview = document.getElementById("crop-preview");
const updateModal = document.getElementById("update-modal");
const updateMessageElement = document.getElementById("update-message");
const updateNowButton = document.getElementById("update-now-button");
const updateLaterButton = document.getElementById("update-later-button");

// ML / quality UI
const aiModelStatusEl = document.getElementById("ai-model-status");
const qualityBadgeWrap = document.getElementById("quality-badge-wrap");
const qualityLabelEl = document.getElementById("quality-label");
const blurScoreDetailEl = document.getElementById("blur-score-detail");
const aiSourceBadgeEl = document.getElementById("ai-source-badge");

const chartState = {
  mode: "week",
  animationFrame: null
};

const SCANNER_CONFIG = {
  minDigits: 3,
  preprocessScale: 2.2,
  cropPaddingX: 0.05,
  cropPaddingY: 0.12,
  minConsensusMatches: 1,
  minAcceptedConfidence: 45,
  tesseractPasses: [
    { id: "original",  label: "Original",  psm: 7 },
    { id: "contrast",  label: "Contrast",  psm: 7 },
    { id: "adaptive",  label: "Adaptive",  psm: 7 },
    { id: "otsu",      label: "OTSU",      psm: 7 }
  ]
};

const ML_CONFIG = {
  blurThreshold: 3.2,      // Laplacian variance × 1500 — below = too blurry
  glareThreshold: 22,       // % of pixels > 0.95 brightness — above = glare
  qualityPollMs: 900,       // ms between live quality checks
  sampleSize: 320           // downscale to this width for fast quality checks
};

const mlState = {
  tfReady: false,
  qualityLoopId: null,
  lastQuality: null,
  tfUsedInLastScan: false
};

const scannerState = {
  stream: null,
  worker: null,
  capturedReading: "",
  capturedConfidence: 0,
  isProcessing: false,
  scanToken: 0,
  activePassLabel: "",
  lastPassSummary: ""
};

function loadReadings() {
  try {
    const savedReadings = localStorage.getItem(STORAGE_KEY);
    const parsedReadings = JSON.parse(savedReadings);

    return Array.isArray(parsedReadings) ? parsedReadings : [];
  } catch (error) {
    return [];
  }
}

function saveReadings(readings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
}

function loadCostPerUnit() {
  const savedCost = Number.parseFloat(localStorage.getItem(COST_STORAGE_KEY));
  return Number.isFinite(savedCost) && savedCost >= 0 ? savedCost : 0;
}

function saveCostPerUnit(costPerUnit) {
  if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
    localStorage.removeItem(COST_STORAGE_KEY);
    return;
  }

  localStorage.setItem(COST_STORAGE_KEY, String(costPerUnit));
}

function formatUnits(value) {
  return `${Number(value).toFixed(2)} units`;
}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function roundToTwo(value) {
  return Number(value.toFixed(2));
}

function isSameLocalDate(timestamp, comparisonDate = new Date()) {
  const entryDate = new Date(timestamp);

  return (
    entryDate.getFullYear() === comparisonDate.getFullYear() &&
    entryDate.getMonth() === comparisonDate.getMonth() &&
    entryDate.getDate() === comparisonDate.getDate()
  );
}

function isSameLocalMonth(timestamp, comparisonDate = new Date()) {
  const entryDate = new Date(timestamp);

  return (
    entryDate.getFullYear() === comparisonDate.getFullYear() &&
    entryDate.getMonth() === comparisonDate.getMonth()
  );
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function getDayKey(input) {
  const date = new Date(input);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function getMonthKey(input) {
  const date = new Date(input);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function addDays(date, numberOfDays) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + numberOfDays);
  return nextDate;
}

function addMonths(date, numberOfMonths) {
  return new Date(date.getFullYear(), date.getMonth() + numberOfMonths, 1);
}

function calculateReadings(readings) {
  const sortedReadings = [...readings].sort((left, right) => left.timestamp - right.timestamp);

  return sortedReadings.map((reading, index) => {
    const previousReading = sortedReadings[index - 1];
    const dailyUsage = previousReading
      ? roundToTwo(reading.meterReading - previousReading.meterReading)
      : 0;

    return {
      ...reading,
      dailyUsage
    };
  });
}

function buildDailyUsageMap(readings) {
  return readings.reduce((usageMap, reading) => {
    const dayKey = getDayKey(reading.timestamp);
    usageMap.set(dayKey, roundToTwo((usageMap.get(dayKey) || 0) + reading.dailyUsage));
    return usageMap;
  }, new Map());
}

function buildMonthlyUsageMap(readings) {
  return readings.reduce((usageMap, reading) => {
    const monthKey = getMonthKey(reading.timestamp);
    usageMap.set(monthKey, roundToTwo((usageMap.get(monthKey) || 0) + reading.dailyUsage));
    return usageMap;
  }, new Map());
}

function getWeeklySeries(readings) {
  const dailyUsageMap = buildDailyUsageMap(readings);
  const today = new Date();
  const series = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const dayKey = getDayKey(date);

    series.push({
      label: date.toLocaleDateString([], { weekday: "short" }),
      value: dailyUsageMap.get(dayKey) || 0,
      detail: date.toLocaleDateString([], { month: "short", day: "numeric" })
    });
  }

  return series;
}

function getMonthlySeries(readings) {
  const monthlyUsageMap = buildMonthlyUsageMap(readings);
  const currentMonth = new Date();
  const series = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = addMonths(currentMonth, -offset);
    const monthKey = getMonthKey(date);

    series.push({
      label: date.toLocaleDateString([], { month: "short" }),
      value: monthlyUsageMap.get(monthKey) || 0,
      detail: date.toLocaleDateString([], { month: "long", year: "numeric" })
    });
  }

  return series;
}

function getUsageSummary(readings) {
  const todayUsage = readings
    .filter((reading) => isSameLocalDate(reading.timestamp))
    .reduce((sum, reading) => sum + reading.dailyUsage, 0);

  const weeklyUsage = getWeeklySeries(readings).reduce((sum, item) => sum + item.value, 0);
  const monthlyUsage = readings
    .filter((reading) => isSameLocalMonth(reading.timestamp))
    .reduce((sum, reading) => sum + reading.dailyUsage, 0);
  const totalUsage = readings.reduce((sum, reading) => sum + reading.dailyUsage, 0);

  return {
    todayUsage: roundToTwo(todayUsage),
    weeklyUsage: roundToTwo(weeklyUsage),
    monthlyUsage: roundToTwo(monthlyUsage),
    totalUsage: roundToTwo(totalUsage)
  };
}

function renderOverview(summary) {
  todayUsageElement.textContent = formatUnits(summary.todayUsage);
  weeklyUsageElement.textContent = formatUnits(summary.weeklyUsage);
  monthlyUsageElement.textContent = formatUnits(summary.monthlyUsage);
  totalUsageElement.textContent = formatUnits(summary.totalUsage);
}

function renderBillEstimates(summary) {
  const costPerUnit = Number.parseFloat(costPerUnitInput.value);
  const safeCostPerUnit = Number.isFinite(costPerUnit) && costPerUnit >= 0 ? costPerUnit : 0;

  weeklyBillElement.textContent = formatMoney(summary.weeklyUsage * safeCostPerUnit);
  monthlyBillElement.textContent = formatMoney(summary.monthlyUsage * safeCostPerUnit);
  totalBillElement.textContent = formatMoney(summary.totalUsage * safeCostPerUnit);
}

function renderHistory(readings) {
  if (readings.length === 0) {
    historyListElement.innerHTML = '<p class="empty-state">No readings saved yet. Add your first meter reading to get started.</p>';
    return;
  }

  const historyMarkup = [...readings]
    .sort((left, right) => right.timestamp - left.timestamp)
    .map((reading) => {
      return `
        <article class="history-item">
          <div>
            <div class="history-item-header">
              <p class="history-item-date">${formatDate(reading.timestamp)}</p>
            </div>
            <p class="history-item-reading">Meter reading: ${reading.meterReading.toFixed(2)}</p>
          </div>
          <div class="history-meta">
            <p class="history-item-usage">Usage: <strong>${formatUnits(reading.dailyUsage)}</strong></p>
            <button class="delete-button" type="button" data-id="${reading.id}" aria-label="Delete reading from ${formatDate(reading.timestamp)}">
              Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  historyListElement.innerHTML = historyMarkup;
}

function setChartMode(mode) {
  chartState.mode = mode;
  weekChartButton.classList.toggle("is-active", mode === "week");
  monthChartButton.classList.toggle("is-active", mode === "month");
  weekChartButton.setAttribute("aria-pressed", String(mode === "week"));
  monthChartButton.setAttribute("aria-pressed", String(mode === "month"));
}

function resizeCanvasToDisplaySize(canvas, height) {
  const context = canvas.getContext("2d");
  const devicePixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(canvas.clientWidth, 1);

  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return context;
}

function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

function drawUsageChart(series) {
  if (chartState.animationFrame) {
    cancelAnimationFrame(chartState.animationFrame);
    chartState.animationFrame = null;
  }

  const hasMeaningfulData = series.some((item) => item.value > 0);
  chartEmptyElement.classList.toggle("is-hidden", hasMeaningfulData);

  const context = resizeCanvasToDisplaySize(usageChartCanvas, 240);
  const width = usageChartCanvas.width / (window.devicePixelRatio || 1);
  const height = usageChartCanvas.height / (window.devicePixelRatio || 1);
  const padding = { top: 18, right: 14, bottom: 38, left: 12 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...series.map((item) => item.value), 1);
  const barWidth = chartWidth / series.length;

  function paintFrame(progress = 1) {
    context.clearRect(0, 0, width, height);

    for (let gridLine = 0; gridLine <= 4; gridLine += 1) {
      const y = padding.top + (chartHeight / 4) * gridLine;
      context.strokeStyle = "rgba(15, 23, 42, 0.08)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
    }

    series.forEach((item, index) => {
      const normalizedValue = item.value / maxValue;
      const animatedValue = normalizedValue * progress;
      const barHeight = Math.max(animatedValue * chartHeight, item.value > 0 ? 4 : 0);
      const x = padding.left + (index * barWidth) + 8;
      const y = padding.top + chartHeight - barHeight;
      const currentBarWidth = Math.max(barWidth - 16, 12);
      const gradient = context.createLinearGradient(0, y, 0, padding.top + chartHeight);

      gradient.addColorStop(0, "#0f766e");
      gradient.addColorStop(1, "#65c9b8");

      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(x, y, currentBarWidth, barHeight, 14);
      context.fill();

      context.fillStyle = "#5d7272";
      context.font = "600 12px Segoe UI";
      context.textAlign = "center";
      context.fillText(item.label, x + currentBarWidth / 2, height - 12);
    });

    context.fillStyle = "#102a2a";
    context.font = "700 13px Segoe UI";
    context.textAlign = "left";
    context.fillText(chartState.mode === "week" ? "Daily usage" : "Monthly usage", padding.left, 12);
  }

  if (!hasMeaningfulData) {
    paintFrame(1);
    return;
  }

  let animationStart;

  function animate(timestamp) {
    if (!animationStart) {
      animationStart = timestamp;
    }

    const progress = Math.min((timestamp - animationStart) / 480, 1);
    paintFrame(easeOutCubic(progress));

    if (progress < 1) {
      chartState.animationFrame = requestAnimationFrame(animate);
    } else {
      chartState.animationFrame = null;
    }
  }

  chartState.animationFrame = requestAnimationFrame(animate);
}

function renderAnalytics(readings) {
  const series = chartState.mode === "week"
    ? getWeeklySeries(readings)
    : getMonthlySeries(readings);

  drawUsageChart(series);
}

function renderApp() {
  const readings = calculateReadings(loadReadings());
  const summary = getUsageSummary(readings);

  saveReadings(readings);
  renderOverview(summary);
  renderBillEstimates(summary);
  renderAnalytics(readings);
  renderHistory(readings);
}

function compareVersions(leftVersion, rightVersion) {
  const leftParts = leftVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function showUpdateModal(version) {
  updateMessageElement.textContent = `Version ${version} is available. Refresh now to install the latest app update.`;
  updateModal.classList.remove("is-hidden");
  updateModal.setAttribute("aria-hidden", "false");
}

function hideUpdateModal() {
  updateModal.classList.add("is-hidden");
  updateModal.setAttribute("aria-hidden", "true");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register("service-worker.js", {
      updateViaCache: "none"
    });

    registration.update();
    return registration;
  } catch (error) {
    return null;
  }
}

async function checkForAppUpdate() {
  try {
    const response = await fetch(`version.json?ts=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const latestVersion = typeof data.version === "string" ? data.version : APP_VERSION;

    if (compareVersions(latestVersion, APP_VERSION) > 0) {
      showUpdateModal(latestVersion);
    }
  } catch (error) {
    // Keep the app usable even if update checks fail offline.
  }
}

async function applyAppUpdate() {
  updateNowButton.disabled = true;
  updateLaterButton.disabled = true;
  updateMessageElement.textContent = "Updating the app and clearing old cached files...";

  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } finally {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("updatedAt", String(Date.now()));
    window.location.replace(nextUrl.toString());
  }
}

function showMessage(text, type = "") {
  messageElement.textContent = text;
  messageElement.className = `form-message ${type}`.trim();
}

function createReading(meterReading) {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    meterReading
  };
}

function handleFormSubmit(event) {
  event.preventDefault();

  const meterReading = Number.parseFloat(readingInput.value);

  if (Number.isNaN(meterReading) || meterReading < 0) {
    showMessage("Enter a valid meter reading greater than or equal to 0.", "error");
    return;
  }

  const readings = calculateReadings(loadReadings());
  const lastReading = readings[readings.length - 1];

  if (lastReading && meterReading < lastReading.meterReading) {
    showMessage("New readings cannot be lower than the previous meter reading.", "error");
    return;
  }

  const nextReadings = calculateReadings([...readings, createReading(meterReading)]);

  saveReadings(nextReadings);
  form.reset();
  readingInput.focus();
  showMessage("Meter reading saved successfully.", "success");
  renderApp();
}

function handleHistoryClick(event) {
  const deleteButton = event.target.closest("[data-id]");

  if (!deleteButton) {
    return;
  }

  const readingId = deleteButton.dataset.id;
  const readings = loadReadings().filter((reading) => reading.id !== readingId);
  const nextReadings = calculateReadings(readings);

  saveReadings(nextReadings);
  showMessage("Reading deleted.", "success");
  renderApp();
}

function escapeCsvValue(value) {
  const stringValue = String(value);

  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function handleExportCsv() {
  const readings = calculateReadings(loadReadings());

  if (readings.length === 0) {
    showMessage("Add at least one reading before exporting CSV.", "error");
    return;
  }

  const csvRows = [
    ["date", "meter_reading", "daily_usage"],
    ...readings.map((reading) => [
      new Date(reading.timestamp).toISOString(),
      reading.meterReading.toFixed(2),
      reading.dailyUsage.toFixed(2)
    ])
  ];

  const csvContent = csvRows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const blobUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  const exportDate = new Date().toISOString().slice(0, 10);

  downloadLink.href = blobUrl;
  downloadLink.download = `smart-electricity-readings-${exportDate}.csv`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(blobUrl);

  showMessage("CSV export downloaded successfully.", "success");
}

function handleCostInput() {
  const costPerUnit = Number.parseFloat(costPerUnitInput.value);

  if (costPerUnitInput.value.trim() === "") {
    saveCostPerUnit(0);
    renderApp();
    return;
  }

  if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
    renderApp();
    return;
  }

  saveCostPerUnit(costPerUnit);
  renderApp();
}

function handleChartToggle(event) {
  const button = event.target.closest("[data-mode]");

  if (!button || button.dataset.mode === chartState.mode) {
    return;
  }

  setChartMode(button.dataset.mode);
  renderAnalytics(calculateReadings(loadReadings()));
}

// ─── TensorFlow.js ML layer ───────────────────────────────────────────────

function isTfAvailable() {
  return typeof window.tf !== "undefined";
}

async function warmUpTf() {
  if (!isTfAvailable() || mlState.tfReady) {
    return;
  }

  try {
    await tf.ready();
    const dummy = tf.zeros([1, 8, 8, 1]);
    const kernel = tf.zeros([3, 3, 1, 1]);
    const result = tf.conv2d(dummy, kernel, 1, "same");
    result.dataSync();
    tf.dispose([dummy, kernel, result]);
    mlState.tfReady = true;
  } catch (_error) {
    mlState.tfReady = false;
  }
}

async function assessImageQuality(sourceCanvas) {
  if (!isTfAvailable()) {
    return { blurScore: 50, glareScore: 0, isUsable: true, label: "OK", level: "good" };
  }

  // Downscale for speed
  const scale = Math.min(1, ML_CONFIG.sampleSize / sourceCanvas.width);
  const sw = Math.max(1, Math.round(sourceCanvas.width * scale));
  const sh = Math.max(1, Math.round(sourceCanvas.height * scale));
  const sampleCanvas = createCanvas(sw, sh);
  sampleCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0, sw, sh);

  const tensors = [];
  let blurScore = 50;
  let glareScore = 0;

  try {
    const img = tf.browser.fromPixels(sampleCanvas, 1);
    tensors.push(img);
    const float = img.toFloat().div(255);
    tensors.push(float);
    const expanded = float.expandDims(0); // [1,H,W,1]
    tensors.push(expanded);

    // Laplacian kernel: measures sharpness via edge variance
    const lapKernel = tf.tensor4d(
      [0, 1, 0, 1, -4, 1, 0, 1, 0],
      [3, 3, 1, 1]
    );
    tensors.push(lapKernel);
    const laplacian = tf.conv2d(expanded, lapKernel, 1, "valid");
    tensors.push(laplacian);
    const variance = laplacian.square().mean();
    tensors.push(variance);
    blurScore = Math.min((await variance.data())[0] * 1500, 100);

    // Glare: ratio of nearly-white pixels
    const overexposed = float.greater(0.95);
    tensors.push(overexposed);
    const overCount = overexposed.sum();
    tensors.push(overCount);
    glareScore = ((await overCount.data())[0] / (sw * sh)) * 100;
  } catch (_err) {
    blurScore = 50;
    glareScore = 0;
  } finally {
    tf.dispose(tensors);
  }

  let label;
  let level;

  if (glareScore >= ML_CONFIG.glareThreshold) {
    label = "Glare detected";
    level = "warn";
  } else if (blurScore < ML_CONFIG.blurThreshold) {
    label = "Too blurry";
    level = "warn";
  } else if (blurScore >= ML_CONFIG.blurThreshold * 2.2 && glareScore < ML_CONFIG.glareThreshold * 0.55) {
    label = "Good quality";
    level = "good";
  } else {
    label = "Acceptable";
    level = "ok";
  }

  return {
    blurScore,
    glareScore,
    isUsable: blurScore >= ML_CONFIG.blurThreshold && glareScore < ML_CONFIG.glareThreshold,
    label,
    level
  };
}

async function applyTfEnhancement(canvas) {
  if (!isTfAvailable()) {
    return canvas;
  }

  const tensors = [];

  try {
    const img = tf.browser.fromPixels(canvas, 1);
    tensors.push(img);
    const float = img.toFloat().div(255).expandDims(0); // [1,H,W,1]
    tensors.push(float);

    // Gaussian blur for noise suppression
    const gaussData = [
      1 / 16, 2 / 16, 1 / 16,
      2 / 16, 4 / 16, 2 / 16,
      1 / 16, 2 / 16, 1 / 16
    ];
    const gaussKernel = tf.tensor4d(gaussData, [3, 3, 1, 1]);
    tensors.push(gaussKernel);
    const blurred = tf.conv2d(float, gaussKernel, 1, "same");
    tensors.push(blurred);

    // Unsharp mask: 0.9× strength avoids ringing on digit edges
    const sharpened = float.add(float.sub(blurred).mul(0.9));
    tensors.push(sharpened);
    const clipped = sharpened.clipByValue(0, 1);
    tensors.push(clipped);

    // [1,H,W,1] → [H,W,1] → [H,W,3] for toPixels
    const squeezed = clipped.squeeze([0]);
    tensors.push(squeezed);
    const rgb = squeezed.tile([1, 1, 3]);
    tensors.push(rgb);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = canvas.width;
    outCanvas.height = canvas.height;
    await tf.browser.toPixels(rgb, outCanvas);
    return outCanvas;
  } catch (_err) {
    return canvas;
  } finally {
    tf.dispose(tensors);
  }
}

function updateQualityBadge(quality) {
  mlState.lastQuality = quality;
  qualityBadgeWrap.classList.remove("is-hidden");
  qualityBadgeWrap.dataset.level = quality.level;
  qualityLabelEl.textContent = quality.label;
  blurScoreDetailEl.textContent =
    quality.blurScore !== undefined
      ? `sharpness ${quality.blurScore.toFixed(1)}`
      : "";
}

function hideQualityBadge() {
  qualityBadgeWrap.classList.add("is-hidden");
  mlState.lastQuality = null;
}

async function runQualityCheck() {
  if (!scannerState.stream || !cameraPreview.videoWidth) {
    return;
  }

  const tmpCanvas = createCanvas(
    cameraPreview.videoWidth,
    cameraPreview.videoHeight
  );
  tmpCanvas.getContext("2d").drawImage(cameraPreview, 0, 0);
  const quality = await assessImageQuality(tmpCanvas);
  updateQualityBadge(quality);
}

function startLiveQualityMonitor() {
  stopLiveQualityMonitor();

  async function loop() {
    await runQualityCheck();
    mlState.qualityLoopId = setTimeout(loop, ML_CONFIG.qualityPollMs);
  }

  mlState.qualityLoopId = setTimeout(loop, 600);
}

function stopLiveQualityMonitor() {
  if (mlState.qualityLoopId !== null) {
    clearTimeout(mlState.qualityLoopId);
    mlState.qualityLoopId = null;
  }
}

function showAiModelStatus(state) {
  aiModelStatusEl.className = `ai-model-badge ai-model-badge--${state}`;
  aiModelStatusEl.textContent = state === "loading" ? "AI Loading\u2026" : "AI Ready";
  aiModelStatusEl.classList.remove("is-hidden");

  if (state === "ready") {
    setTimeout(() => aiModelStatusEl.classList.add("is-hidden"), 2800);
  }
}

function hideAiModelStatus() {
  aiModelStatusEl.classList.add("is-hidden");
}

function setAiSourceBadge(visible) {
  aiSourceBadgeEl.classList.toggle("is-hidden", !visible);
}

// ─── End of ML layer ──────────────────────────────────────────────────────

function setScannerMessage(text) {
  scannerStatusElement.textContent = text;
}

function getConfidenceMeta(score) {
  if (!score) {
    return { label: "--", level: "idle" };
  }

  if (score >= 85) {
    return { label: `High ${score}%`, level: "high" };
  }

  if (score >= 65) {
    return { label: `Medium ${score}%`, level: "medium" };
  }

  return { label: `Low ${score}%`, level: "low" };
}

function setConfidenceIndicator(score = 0) {
  const { label, level } = getConfidenceMeta(score);
  ocrConfidenceElement.textContent = `Confidence: ${label}`;
  ocrConfidenceElement.dataset.level = level;
}

function setScannerPassSummary(text = "Capture a clear frame to start multi-pass scanning.") {
  scannerState.lastPassSummary = text;
  scannerPassSummaryElement.textContent = text;
}

function setScannerLoading(isLoading) {
  scannerState.isProcessing = isLoading;
  scannerLoadingElement.classList.toggle("is-hidden", !isLoading);
  captureButton.disabled = isLoading || !scannerState.stream;
  retakeButton.disabled = isLoading;
  useReadingButton.disabled = isLoading || !scannerState.capturedReading;
}

function setDetectedReading(reading, confidence = 0) {
  scannerState.capturedReading = reading;
  scannerState.capturedConfidence = confidence;
  ocrResultElement.innerHTML = `Detected reading: <strong>${reading || "--"}</strong>`;
  setConfidenceIndicator(reading ? confidence : 0);
  useReadingButton.disabled = !reading || scannerState.isProcessing;
}

function showScanner() {
  scannerModal.classList.remove("is-hidden");
  scannerModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("scanner-open");
}

function hideScanner() {
  scannerModal.classList.add("is-hidden");
  scannerModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("scanner-open");
}

function setScannerMode(mode) {
  const isLive = mode === "live";

  cameraPreview.classList.toggle("is-hidden", !isLive);
  capturePreview.classList.toggle("is-hidden", isLive);
  guideBox.classList.toggle("is-hidden", !isLive);
  captureButton.classList.toggle("is-hidden", !isLive);
  useReadingButton.classList.toggle("is-hidden", isLive);
  retakeButton.classList.toggle("is-hidden", isLive);
}

function resetCapturedState() {
  scannerState.scanToken += 1;
  scannerState.activePassLabel = "";
  capturePreview.removeAttribute("src");
  resetCropPreview();
  setDetectedReading("", 0);
  setScannerPassSummary();
  setScannerLoading(false);
}

function stopCamera() {
  if (!scannerState.stream) {
    return;
  }

  scannerState.stream.getTracks().forEach((track) => track.stop());
  scannerState.stream = null;
  cameraPreview.srcObject = null;
}

async function requestCameraStream() {
  const preferredConstraints = {
    audio: false,
    video: {
      facingMode: { exact: "environment" },
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30 }
    }
  };

  const fallbackConstraints = {
    audio: false,
    video: {
      facingMode: "environment",
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30 }
    }
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferredConstraints);
  } catch (error) {
    if (error.name !== "OverconstrainedError" && error.name !== "NotFoundError") {
      throw error;
    }

    return navigator.mediaDevices.getUserMedia(fallbackConstraints);
  }
}

async function applyTrackPreferences(stream) {
  const [track] = stream.getVideoTracks();

  if (!track || typeof track.applyConstraints !== "function") {
    return;
  }

  try {
    const capabilities = typeof track.getCapabilities === "function"
      ? track.getCapabilities()
      : null;
    const advancedConstraints = [];

    if (Array.isArray(capabilities?.focusMode) && capabilities.focusMode.includes("continuous")) {
      advancedConstraints.push({ focusMode: "continuous" });
    }

    if (Array.isArray(capabilities?.exposureMode) && capabilities.exposureMode.includes("continuous")) {
      advancedConstraints.push({ exposureMode: "continuous" });
    }

    if (Array.isArray(capabilities?.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
      advancedConstraints.push({ whiteBalanceMode: "continuous" });
    }

    if (advancedConstraints.length > 0) {
      await track.applyConstraints({ advanced: advancedConstraints });
    }
  } catch (error) {
    // Best-effort only. Unsupported camera controls should never block scanning.
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setScannerMessage("Camera access is not supported in this browser.");
    return;
  }

  stopCamera();
  resetCapturedState();
  setScannerMode("live");
  captureButton.disabled = true;
  setScannerMessage("Starting the rear camera...");
  const scanToken = scannerState.scanToken;

  try {
    const stream = await requestCameraStream();

    if (scanToken !== scannerState.scanToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    scannerState.stream = stream;
    cameraPreview.srcObject = stream;
    await cameraPreview.play();
    await applyTrackPreferences(stream);

    if (scanToken !== scannerState.scanToken) {
      stopCamera();
      return;
    }

    captureButton.disabled = false;
    setScannerPassSummary("Guide crop locked to the center box. Capture when the digits look sharp and evenly lit.");
    setScannerMessage("Hold steady, use good lighting, and keep the meter digits inside the guide box.");
  } catch (error) {
    if (scanToken !== scannerState.scanToken) {
      return;
    }

    const permissionMessage = error.name === "NotAllowedError"
      ? "Camera permission was denied. Please allow access and try again."
      : "Unable to open the camera. Use HTTPS or localhost and check camera availability.";

    stopCamera();
    setScannerMessage(permissionMessage);
    captureButton.disabled = true;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createFullFrameCanvas() {
  const videoWidth = cameraPreview.videoWidth;
  const videoHeight = cameraPreview.videoHeight;

  if (!videoWidth || !videoHeight) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = videoWidth;
  canvas.height = videoHeight;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);

  return canvas;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function cloneCanvas(sourceCanvas) {
  const canvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  const context = canvas.getContext("2d");

  context.drawImage(sourceCanvas, 0, 0);
  return canvas;
}

function getDisplayedVideoRegion() {
  const elementWidth = cameraPreview.clientWidth;
  const elementHeight = cameraPreview.clientHeight;
  const videoWidth = cameraPreview.videoWidth;
  const videoHeight = cameraPreview.videoHeight;

  if (!elementWidth || !elementHeight || !videoWidth || !videoHeight) {
    return null;
  }

  // The video element uses object-fit: cover, which means the video is
  // uniformly scaled so BOTH dimensions are >= the element dimensions.
  // The larger scale wins, and the overflow is cropped symmetrically.
  const scaleToFillWidth  = elementWidth  / videoWidth;
  const scaleToFillHeight = elementHeight / videoHeight;
  const coverScale = Math.max(scaleToFillWidth, scaleToFillHeight);

  // Rendered video size in CSS pixels (one axis will equal the element, the
  // other will overflow and be clipped).
  const drawWidth  = videoWidth  * coverScale;
  const drawHeight = videoHeight * coverScale;

  // How far the rendered video extends BEYOND the element's top-left corner
  // (always <= 0 for the clipped axis, 0 for the filled axis).
  const offsetX = (elementWidth  - drawWidth)  / 2;  // negative when wider
  const offsetY = (elementHeight - drawHeight) / 2;  // negative when taller

  return { drawWidth, drawHeight, offsetX, offsetY, coverScale };
}

function createGuideCropCanvas(sourceCanvas, frozenGuideRect) {
  const videoRegion = getDisplayedVideoRegion();
  const videoRect   = cameraPreview.getBoundingClientRect();
  // Use the frozen rect captured before any layout shifts, or fall back to live.
  const guideRect   = frozenGuideRect || guideBox.getBoundingClientRect();

  if (!videoRegion || !videoRect.width || !guideRect.width || !guideRect.height) {
    // Fallback: crop the horizontal centre strip (64% wide, 24% tall)
    const fw = Math.round(sourceCanvas.width  * 0.64);
    const fh = Math.round(sourceCanvas.height * 0.24);
    const fx = Math.round(sourceCanvas.width  * 0.18);
    const fy = Math.round(sourceCanvas.height * 0.38);
    const fc = createCanvas(fw, fh);
    fc.getContext("2d").drawImage(
      sourceCanvas,
      clamp(fx, 0, sourceCanvas.width  - 1),
      clamp(fy, 0, sourceCanvas.height - 1),
      clamp(fw, 1, sourceCanvas.width  - fx),
      clamp(fh, 1, sourceCanvas.height - fy),
      0, 0, fc.width, fc.height
    );
    return fc;
  }

  // ── Convert guide-box screen coordinates → video pixel coordinates ──────
  //
  // coverScale converts video pixels → CSS pixels (object-fit: cover scale).
  // Its inverse converts CSS pixels → video pixels.
  const { offsetX, offsetY, coverScale } = videoRegion;

  // Position of the guide box relative to the top-left of the *rendered*
  // video content (which starts at videoRect.left + offsetX, videoRect.top + offsetY).
  const relativeLeft = guideRect.left - (videoRect.left + offsetX);
  const relativeTop  = guideRect.top  - (videoRect.top  + offsetY);

  // Convert from CSS display pixels to video pixels.
  const toVideoPixel = 1 / coverScale;

  // Small padding (8% X, 10% Y) keeps digits from touching the crop edge.
  const padX = guideRect.width  * SCANNER_CONFIG.cropPaddingX * toVideoPixel;
  const padY = guideRect.height * SCANNER_CONFIG.cropPaddingY * toVideoPixel;

  const crop = {
    x:      Math.round(relativeLeft * toVideoPixel - padX),
    y:      Math.round(relativeTop  * toVideoPixel - padY),
    width:  Math.round(guideRect.width  * toVideoPixel + padX * 2),
    height: Math.round(guideRect.height * toVideoPixel + padY * 2)
  };

  crop.x      = clamp(crop.x,      0, sourceCanvas.width  - 1);
  crop.y      = clamp(crop.y,      0, sourceCanvas.height - 1);
  crop.width  = clamp(crop.width,  1, sourceCanvas.width  - crop.x);
  crop.height = clamp(crop.height, 1, sourceCanvas.height - crop.y);

  const canvas  = createCanvas(crop.width, crop.height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled  = true;
  context.imageSmoothingQuality  = "high";
  context.drawImage(
    sourceCanvas,
    crop.x, crop.y, crop.width, crop.height,
    0,      0,      canvas.width, canvas.height
  );
  return canvas;
}

function createOcrBaseCanvas(sourceCanvas) {
  const scaleFactor = SCANNER_CONFIG.preprocessScale;
  // Tight, fixed padding — large empty margins confuse Tesseract layout analysis
  const paddingX = Math.round(sourceCanvas.width  * 0.04 * scaleFactor);
  const paddingY = Math.round(sourceCanvas.height * 0.06 * scaleFactor);
  const scaledWidth  = Math.round(sourceCanvas.width  * scaleFactor);
  const scaledHeight = Math.round(sourceCanvas.height * scaleFactor);
  const canvas  = createCanvas(scaledWidth + (paddingX * 2), scaledHeight + (paddingY * 2));
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled  = true;
  context.imageSmoothingQuality  = "high";
  context.drawImage(
    sourceCanvas,
    0, 0, sourceCanvas.width, sourceCanvas.height,
    paddingX, paddingY, scaledWidth, scaledHeight
  );

  return canvas;
}

function extractGrayscalePixels(imageData) {
  const grayscale = new Uint8ClampedArray(imageData.width * imageData.height);
  const { data } = imageData;

  for (let index = 0, pixelIndex = 0; index < data.length; index += 4, pixelIndex += 1) {
    grayscale[pixelIndex] = Math.round(
      (data[index] * 0.299) +
      (data[index + 1] * 0.587) +
      (data[index + 2] * 0.114)
    );
  }

  return grayscale;
}

function buildHistogram(pixels) {
  const histogram = new Uint32Array(256);

  for (const value of pixels) {
    histogram[value] += 1;
  }

  return histogram;
}

function getPercentileValue(histogram, totalPixels, percentile) {
  const target = totalPixels * percentile;
  let runningTotal = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    runningTotal += histogram[value];

    if (runningTotal >= target) {
      return value;
    }
  }

  return 255;
}

function applyLevels(pixels, options = {}) {
  const {
    blackPointPercentile = 0.01,
    whitePointPercentile = 0.99,
    gamma = 1
  } = options;
  const histogram = buildHistogram(pixels);
  const blackPoint = getPercentileValue(histogram, pixels.length, blackPointPercentile);
  const whitePoint = Math.max(blackPoint + 8, getPercentileValue(histogram, pixels.length, whitePointPercentile));
  const leveled = new Uint8ClampedArray(pixels.length);

  for (let index = 0; index < pixels.length; index += 1) {
    const normalized = clamp((pixels[index] - blackPoint) / (whitePoint - blackPoint), 0, 1);
    leveled[index] = Math.round((normalized ** gamma) * 255);
  }

  return leveled;
}

function applyContrastBoost(pixels, factor = 1.25) {
  const contrasted = new Uint8ClampedArray(pixels.length);

  for (let index = 0; index < pixels.length; index += 1) {
    contrasted[index] = clamp(Math.round(((pixels[index] - 128) * factor) + 128), 0, 255);
  }

  return contrasted;
}

function ensureLightBackground(pixels, width, height) {
  const edgeThickness = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  let edgeTotal = 0;
  let edgeCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < edgeThickness || x >= width - edgeThickness || y < edgeThickness || y >= height - edgeThickness) {
        edgeTotal += pixels[(y * width) + x];
        edgeCount += 1;
      }
    }
  }

  if (edgeCount && (edgeTotal / edgeCount) < 128) {
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = 255 - pixels[index];
    }
  }

  return pixels;
}

function applySharpenToGrayscale(pixels, width, height) {
  const source = new Uint8ClampedArray(pixels);
  const sharpened = new Uint8ClampedArray(pixels);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let value = 0;
      let kernelIndex = 0;

      for (let sampleY = -1; sampleY <= 1; sampleY += 1) {
        for (let sampleX = -1; sampleX <= 1; sampleX += 1) {
          value += source[((y + sampleY) * width) + (x + sampleX)] * kernel[kernelIndex];
          kernelIndex += 1;
        }
      }

      sharpened[(y * width) + x] = clamp(Math.round(value), 0, 255);
    }
  }

  return sharpened;
}

// OTSU global threshold — finds the optimal separation between
// digit pixels and background via inter-class variance maximisation.
// Works very well for LCD / 7-segment displays with clear contrast.
function applyOtsuThreshold(pixels, width, height) {
  const histogram = buildHistogram(pixels);
  const total = pixels.length;
  let sum = 0;

  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVar) { maxVar = variance; threshold = t; }
  }

  const result = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    result[i] = pixels[i] <= threshold ? 0 : 255;
  }
  return ensureLightBackground(result, width, height);
}

function applyAdaptiveThreshold(pixels, width, height) {
  const radius = Math.max(12, Math.round(Math.min(width, height) * 0.08));
  const bias = 10;
  const integralWidth = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowTotal = 0;

    for (let x = 1; x <= width; x += 1) {
      rowTotal += pixels[((y - 1) * width) + (x - 1)];
      integral[(y * integralWidth) + x] = integral[((y - 1) * integralWidth) + x] + rowTotal;
    }
  }

  const thresholded = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (right - left + 1) * (bottom - top + 1);
      const sum =
        integral[((bottom + 1) * integralWidth) + (right + 1)] -
        integral[(top * integralWidth) + (right + 1)] -
        integral[((bottom + 1) * integralWidth) + left] +
        integral[(top * integralWidth) + left];
      const index = (y * width) + x;
      const localAverage = sum / area;

      thresholded[index] = pixels[index] > (localAverage - bias) ? 255 : 0;
    }
  }

  return ensureLightBackground(thresholded, width, height);
}

function createCanvasFromGrayscale(pixels, width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.createImageData(width, height);

  for (let index = 0, pixelIndex = 0; pixelIndex < pixels.length; index += 4, pixelIndex += 1) {
    imageData.data[index] = pixels[pixelIndex];
    imageData.data[index + 1] = pixels[pixelIndex];
    imageData.data[index + 2] = pixels[pixelIndex];
    imageData.data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function buildOcrVariants(sourceCanvas) {
  const baseCanvas = createOcrBaseCanvas(sourceCanvas);
  const context    = baseCanvas.getContext("2d", { willReadFrequently: true });
  const imageData  = context.getImageData(0, 0, baseCanvas.width, baseCanvas.height);

  // Normalised grayscale with light background guaranteed
  const normalizedGrayscale = ensureLightBackground(
    applyLevels(extractGrayscalePixels(imageData), {
      blackPointPercentile: 0.01,
      whitePointPercentile: 0.99,
      gamma: 0.96
    }),
    baseCanvas.width,
    baseCanvas.height
  );

  // High-contrast levelled version — base for binarization passes
  const contrastPixels = applyContrastBoost(
    applyLevels(normalizedGrayscale, {
      blackPointPercentile: 0.02,
      whitePointPercentile: 0.985,
      gamma: 0.88   // slightly darker to make digits bold
    }),
    1.5           // stronger contrast boost
  );

  // Adaptive threshold — handles uneven lighting across the meter face
  const adaptivePixels = applyAdaptiveThreshold(contrastPixels, baseCanvas.width, baseCanvas.height);

  // OTSU global threshold — best for high-contrast LCD / 7-segment displays
  const otsuPixels = applyOtsuThreshold(normalizedGrayscale, baseCanvas.width, baseCanvas.height);

  return [
    { id: "original", label: "Original", canvas: cloneCanvas(baseCanvas) },
    { id: "contrast",  label: "Contrast",  canvas: createCanvasFromGrayscale(contrastPixels, baseCanvas.width, baseCanvas.height) },
    { id: "adaptive",  label: "Adaptive",  canvas: createCanvasFromGrayscale(adaptivePixels, baseCanvas.width, baseCanvas.height) },
    { id: "otsu",      label: "OTSU",      canvas: createCanvasFromGrayscale(otsuPixels,     baseCanvas.width, baseCanvas.height) }
  ];
}

function normalizeOcrText(text) {
  const normalizationMap = {
    O: "0",
    D: "0",
    Q: "0",
    I: "1",
    L: "1",
    "|": "1",
    S: "5",
    B: "8"
  };
  const cleanedText = String(text || "")
    .toUpperCase()
    .split("")
    .map((character) => normalizationMap[character] || character)
    .join("")
    .replace(/[^0-9]/g, " ");
  const sequences = (cleanedText.match(/\d+/g) || []).sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }

    return Number.parseInt(right, 10) - Number.parseInt(left, 10);
  });

  if (sequences.length > 0) {
    return sequences[0];
  }

  return cleanedText.replace(/[^0-9]/g, "");
}

function formatProgressStatus(status) {
  if (!status) {
    return "Scanning reading...";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function getOcrWorker() {
  if (scannerState.worker) {
    return scannerState.worker;
  }

  scannerState.worker = await Tesseract.createWorker("eng", 1, {
    logger: ({ status, progress }) => {
      if (!scannerState.isProcessing) {
        return;
      }

      const progressText = typeof progress === "number"
        ? `${Math.round(progress * 100)}%`
        : "";
      const prefix = scannerState.activePassLabel
        ? `${scannerState.activePassLabel}: `
        : "";

      setScannerMessage([`${prefix}${formatProgressStatus(status)}`, progressText].filter(Boolean).join(" "));
    }
  });

  // PSM 7 = single text line, best for meter digit sequences.
  // DPI 70 matches the actual rendered px-per-inch of the upscaled crop canvas.
  await scannerState.worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: 7,
    preserve_interword_spaces: 0,
    classify_bln_numeric_mode: 1,
    user_defined_dpi: "70"
  });

  return scannerState.worker;
}

function createOcrCandidate({
  engine,
  variantId,
  label,
  rawText,
  confidence,
  previewCanvas
}) {
  const text = normalizeOcrText(rawText);
  const normalizedConfidence = clamp(Math.round(confidence || 0), 0, 100);

  return {
    engine,
    variantId,
    label,
    rawText: String(rawText || "").trim(),
    text,
    confidence: normalizedConfidence,
    previewCanvas,
    score: normalizedConfidence + (text.length * 8) + (engine === "ocrad" ? -8 : 0)
  };
}

async function runTesseractPasses(variants, scanToken) {
  const worker = await getOcrWorker();
  const passResults = [];

  for (const pass of SCANNER_CONFIG.tesseractPasses) {
    if (scanToken !== scannerState.scanToken) {
      return [];
    }

    const variant = variants.find((entry) => entry.id === pass.id);

    if (!variant) {
      continue;
    }

    scannerState.activePassLabel = `${pass.label} pass`;
    setScannerMessage(`Running ${pass.label.toLowerCase()} OCR pass...`);

    // Override PSM per pass so each variant tries a different segmentation
    // mode — this is the main way to recover from Tesseract refusing to
    // segment a particular image layout.
    if (pass.psm !== undefined) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: pass.psm });
      } catch (_e) { /* ignore — worker keeps previous PSM */ }
    }

    const result = await worker.recognize(variant.canvas);

    passResults.push(createOcrCandidate({
      engine: "tesseract",
      variantId: pass.id,
      label: pass.label,
      rawText: result.data?.text || "",
      confidence: result.data?.confidence || 0,
      previewCanvas: variant.canvas
    }));
  }

  return passResults;
}

function runFallbackOcrPass(variants) {
  if (typeof window.OCRAD !== "function") {
    return [];
  }

  const adaptiveVariant = variants.find((entry) => entry.id === "adaptive") || variants[0];

  if (!adaptiveVariant) {
    return [];
  }

  try {
    scannerState.activePassLabel = "Fallback pass";
    setScannerMessage("Cross-checking with fallback OCR...");

    return [
      createOcrCandidate({
        engine: "ocrad",
        variantId: adaptiveVariant.id,
        label: "Fallback",
        rawText: window.OCRAD(adaptiveVariant.canvas) || "",
        confidence: 54,
        previewCanvas: adaptiveVariant.canvas
      })
    ];
  } catch (error) {
    return [];
  }
}

function chooseBestOcrResult(candidates) {
  const usableCandidates = candidates.filter((c) => c.text && c.text.length >= SCANNER_CONFIG.minDigits);

  if (usableCandidates.length === 0) {
    // Try with any non-empty text as a last resort
    const anyCandidates = candidates.filter((c) => c.text);
    if (anyCandidates.length === 0) {
      return { accepted: false, confidence: 0, bestCandidate: null, bestText: "" };
    }
    const best = anyCandidates.sort((a, b) => b.confidence - a.confidence)[0];
    return { accepted: false, confidence: best.confidence, bestCandidate: best, bestText: best.text };
  }

  // ── Plausibility fast-path ────────────────────────────────────────────────
  // If any single pass returned a confident, plausible digit string (4-8 digits)
  // that is all-numeric and reasonably long, accept it immediately without
  // requiring multi-pass consensus.  This covers the common case where the
  // image is clear but Tesseract variants disagree by just 1 digit.
  const plausibleLength = (t) => t.length >= 4 && t.length <= 8;
  const strongSingle = usableCandidates
    .filter((c) => c.confidence >= 65 && plausibleLength(c.text))
    .sort((a, b) => (b.confidence + b.text.length * 4) - (a.confidence + a.text.length * 4))[0];

  if (strongSingle) {
    const fastConfidence = clamp(Math.round(strongSingle.confidence * 0.8 + strongSingle.text.length * 2), 0, 99);
    return {
      accepted: fastConfidence >= SCANNER_CONFIG.minAcceptedConfidence,
      confidence: fastConfidence,
      bestCandidate: strongSingle,
      bestText: strongSingle.text
    };
  }

  // ── Group by identical text across passes ─────────────────────────────────
  const groupedCandidates = usableCandidates.reduce((groups, candidate) => {
    const group = groups.get(candidate.text) || {
      text: candidate.text,
      count: 0,
      totalConfidence: 0,
      bestConfidence: 0,
      bestCandidate: candidate,
      engineSet: new Set(),
      variantSet: new Set(),
      weightedScore: 0
    };

    group.count += 1;
    group.totalConfidence += candidate.confidence;
    group.bestConfidence = Math.max(group.bestConfidence, candidate.confidence);
    group.engineSet.add(candidate.engine);
    group.variantSet.add(candidate.variantId);
    group.weightedScore += candidate.score;

    if (
      candidate.confidence > group.bestCandidate.confidence ||
      (candidate.confidence === group.bestCandidate.confidence && candidate.text.length > group.bestCandidate.text.length)
    ) {
      group.bestCandidate = candidate;
    }

    groups.set(candidate.text, group);
    return groups;
  }, new Map());

  const rankedGroups = [...groupedCandidates.values()]
    .map((group) => {
      const averageConfidence = group.totalConfidence / group.count;
      const finalScore =
        (group.count * 52) +
        (group.engineSet.size * 16) +
        (group.variantSet.size * 10) +
        (group.text.length * 7) +
        (averageConfidence * 0.55) +
        (group.bestConfidence * 0.12) +
        (group.weightedScore * 0.1);

      return { ...group, averageConfidence, finalScore };
    })
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
      if (right.count !== left.count)           return right.count - left.count;
      if (right.text.length !== left.text.length) return right.text.length - left.text.length;
      return right.bestConfidence - left.bestConfidence;
    });

  const bestGroup = rankedGroups[0];
  const runnerUp  = rankedGroups[1];
  const consensusRatio = bestGroup.count / usableCandidates.length;

  // Confidence: weighted blend of Tesseract score + consensus bonus
  const confidence = clamp(
    Math.round(
      (bestGroup.averageConfidence * 0.50) +
      (bestGroup.bestConfidence   * 0.15) +
      (consensusRatio * 100       * 0.20) +
      (bestGroup.engineSet.size > 1 ? 8 : 0) +
      Math.min(14, bestGroup.text.length * 2.5)
    ),
    0,
    99
  );

  // Accept if: enough digits AND (at least 1 pass agrees OR confidence OK)
  const consistentEnough =
    bestGroup.count >= SCANNER_CONFIG.minConsensusMatches ||
    (bestGroup.engineSet.size > 1 && consensusRatio >= 0.3);

  // Separation: skip when there is clearly only one candidate
  const separatedEnough =
    !runnerUp ||
    bestGroup.count > runnerUp.count ||
    (bestGroup.finalScore - runnerUp.finalScore) >= 8;

  const accepted =
    bestGroup.text.length >= SCANNER_CONFIG.minDigits &&
    consistentEnough &&
    separatedEnough &&
    confidence >= SCANNER_CONFIG.minAcceptedConfidence;

  return {
    accepted,
    confidence,
    bestCandidate: bestGroup.bestCandidate,
    bestText: bestGroup.text
  };
}

function summarizePasses(candidates) {
  if (candidates.length === 0) {
    return "No OCR passes produced readable digits on this frame.";
  }

  return candidates
    .map((candidate) => {
      const reading = candidate.text || "--";
      const confidence = candidate.engine === "ocrad"
        ? ""
        : ` ${candidate.confidence}%`;

      return `${candidate.label}: ${reading}${confidence}`.trim();
    })
    .join(" | ");
}

function updateCropPreview(canvas) {
  if (!canvas) {
    resetCropPreview();
    return;
  }

  cropPreview.src = canvas.toDataURL("image/png");
  cropPreview.classList.remove("is-hidden");
}

async function runMlEnhancedOcr(capturedCanvas, scanToken) {
  setDetectedReading("", 0);
  setAiSourceBadge(false);
  setScannerLoading(true);
  setScannerPassSummary("Preparing crop for multi-pass analysis...");
  setScannerMessage("Running AI quality check...");
  mlState.tfUsedInLastScan = false;

  try {
    // ── Stage 1: ML quality gate ──────────────────────────────────────────
    const quality = await assessImageQuality(capturedCanvas);

    if (scanToken !== scannerState.scanToken) {
      return;
    }

    if (!quality.isUsable) {
      const reason = quality.glareScore >= ML_CONFIG.glareThreshold
        ? "Too much glare on the meter. Tilt slightly to reduce reflections."
        : "Image too blurry. Hold the phone steadier and ensure good lighting.";

      setScannerMessage(`AI quality check: ${reason}`);
      setScannerPassSummary(`Sharpness: ${quality.blurScore.toFixed(1)} | Glare: ${quality.glareScore.toFixed(1)}%`);
      setConfidenceIndicator(0);
      // Still run OCR — quality gate is advisory, not hard-blocking
    } else {
      setScannerMessage("Quality OK. Enhancing image with AI...");
    }

    // ── Stage 2: skip TF enhancement — Gaussian blur before Tesseract
    // blurs digit edges and hurts accuracy. TF.js is used only for
    // the quality gate above.
    // ── Stage 3: Multi-pass Tesseract OCR on the raw cropped image ────────
    setScannerMessage("Running ensemble OCR passes...");
    const variants = buildOcrVariants(capturedCanvas);

    if (scanToken !== scannerState.scanToken) {
      return;
    }

    updateCropPreview((variants.find((v) => v.id === "adaptive") || variants[0])?.canvas || null);

    const tesseractResults = await runTesseractPasses(variants, scanToken);

    if (scanToken !== scannerState.scanToken) {
      return;
    }

    const fallbackResults = runFallbackOcrPass(variants);
    const allResults = [...tesseractResults, ...fallbackResults];
    const decision = chooseBestOcrResult(allResults);
    const previewCanvas =
      decision.bestCandidate?.previewCanvas ||
      (variants.find((v) => v.id === "adaptive") || variants[0])?.canvas ||
      null;

    updateCropPreview(previewCanvas);

    // Build pass summary — prepend quality info
    const qualityNote = quality.isUsable
      ? `AI: sharp ${quality.blurScore.toFixed(1)}`
      : `AI: ${quality.label}`;
    setScannerPassSummary(`${qualityNote} | ${summarizePasses(allResults)}`);

    if (mlState.tfUsedInLastScan) {
      setAiSourceBadge(true);
    }

    if (!decision.accepted || !decision.bestText) {
      setConfidenceIndicator(decision.confidence);
      setScannerMessage("Low confidence result. Retake with steadier framing, less glare, and brighter light.");
      return;
    }

    setDetectedReading(decision.bestText, decision.confidence);
    setScannerMessage("Reading detected. Review the number and save it if it looks correct.");
  } catch (error) {
    if (scanToken === scannerState.scanToken) {
      setDetectedReading("", 0);
      setScannerPassSummary("The scanner could not reach a stable numeric consensus on this frame.");
      setScannerMessage("OCR failed on this capture. Retake the photo and try again.");
    }
  } finally {
    scannerState.activePassLabel = "";

    if (scanToken === scannerState.scanToken) {
      setScannerLoading(false);
    }
  }
}

async function handleCapture() {
  if (!scannerState.stream || scannerState.isProcessing) {
    return;
  }

  // Snapshot the guide-box position FIRST, before anything changes the layout.
  // hideQualityBadge() and stopCamera() can trigger reflows that shift the
  // guide box, making its live getBoundingClientRect() stale at crop time.
  const frozenGuideRect = guideBox.getBoundingClientRect();

  const fullFrameCanvas = createFullFrameCanvas();

  if (!fullFrameCanvas) {
    setScannerMessage("The camera is not ready yet. Try capturing again in a moment.");
    return;
  }

  stopLiveQualityMonitor();
  hideQualityBadge();

  // Pass the frozen rect so the crop matches the frame the user just captured.
  const capturedCanvas = createGuideCropCanvas(fullFrameCanvas, frozenGuideRect);

  capturePreview.src = fullFrameCanvas.toDataURL("image/jpeg", 0.95);
  stopCamera();
  setScannerMode("captured");
  setScannerPassSummary("Full-resolution frame captured. Running AI-enhanced OCR passes...");
  await runMlEnhancedOcr(capturedCanvas, scannerState.scanToken);
}


async function openScanner() {
  showScanner();
  setConfidenceIndicator(0);
  setAiSourceBadge(false);

  // Lazy-warm TF.js on first open
  if (isTfAvailable() && !mlState.tfReady) {
    showAiModelStatus("loading");
    warmUpTf().then(() => {
      if (mlState.tfReady) {
        showAiModelStatus("ready");
      } else {
        hideAiModelStatus();
      }
    });
  }

  await startCamera();
  startLiveQualityMonitor();
}

function closeScanner() {
  stopLiveQualityMonitor();
  hideQualityBadge();
  stopCamera();
  resetCapturedState();
  setScannerMode("live");
  setScannerMessage("Hold steady, use good lighting, and keep the meter digits inside the guide box.");
  hideScanner();
}

async function retakeCapture() {
  hideQualityBadge();
  resetCapturedState();
  await startCamera();
  startLiveQualityMonitor();
}

function applyDetectedReading() {
  if (!scannerState.capturedReading) {
    return;
  }

  readingInput.value = scannerState.capturedReading;
  showMessage("Scanned reading added to the input. Review it and tap Save Reading.", "success");
  closeScanner();
  readingInput.focus();
}

function handleEscapeClose(event) {
  if (event.key === "Escape" && !scannerModal.classList.contains("is-hidden")) {
    closeScanner();
  }
}

async function cleanupOcrWorker() {
  if (!scannerState.worker) {
    return;
  }

  await scannerState.worker.terminate();
  scannerState.worker = null;
  scannerState.activePassLabel = "";
}

function resetCropPreview() {
  cropPreview.removeAttribute("src");
  cropPreview.classList.add("is-hidden");
}

let resizeTimer;

function handleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderAnalytics(calculateReadings(loadReadings()));
  }, 120);
}

form.addEventListener("submit", handleFormSubmit);
historyListElement.addEventListener("click", handleHistoryClick);
costPerUnitInput.addEventListener("input", handleCostInput);
exportButton.addEventListener("click", handleExportCsv);
weekChartButton.addEventListener("click", handleChartToggle);
monthChartButton.addEventListener("click", handleChartToggle);
updateNowButton.addEventListener("click", applyAppUpdate);
updateLaterButton.addEventListener("click", hideUpdateModal);
openScannerButton.addEventListener("click", openScanner);
closeScannerButton.addEventListener("click", closeScanner);
captureButton.addEventListener("click", handleCapture);
retakeButton.addEventListener("click", retakeCapture);
useReadingButton.addEventListener("click", applyDetectedReading);
window.addEventListener("keydown", handleEscapeClose);
window.addEventListener("resize", handleResize);
window.addEventListener("beforeunload", () => {
  stopLiveQualityMonitor();
  stopCamera();
  cleanupOcrWorker();
});

const savedCostPerUnit = loadCostPerUnit();
costPerUnitInput.value = savedCostPerUnit ? savedCostPerUnit.toFixed(2) : "";
setChartMode("week");
renderApp();
registerServiceWorker().then(() => {
  checkForAppUpdate();
});
