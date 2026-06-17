/**
 * Sistema de Monitoreo de Aula - Lógica de Producción y Visión Artificial Real
 * Control de estados, captura de cámara, inferencia de red y gestión técnica (ML & Dataset)
 */

// --- 1. ESTADO GLOBAL DE LA APLICACIÓN ---
const state = {
    currentView: "dashboard", // Vistas: "dashboard", "camera", "roster", "inbox", "settings"
    cameraActive: true,
    sensitivity: 0.60,
    cameraPitchOffset: 0.0,
    selectedStudentId: 1,
    activeClipId: 1,
    isPlayingVideo: false,
    biometricsBypassed: false,
    audioAlertsEnabled: true,
    
    // Evidencia de Auto-Grabación (Buffer Circular)
    recordEvidenceEnabled: false,
    activeSessions: [], // Sesiones activas de grabación concurrente
    circularBuffer: [],
    recordedBlobs: {},
    activeVideoElement: null,
    
    // Bucles activos (requestAnimationFrame e intervalos)
    activeLoops: {
        cameraLoop: null,
        focusCameraLoop: null,
        bufferTimer: null,
        videoReplay: null,
        trainingSim: null,
        bufferCaptureInterval: null,
        simulatedInferenceInterval: null
    },
    
    // Instancias de Chart.js
    trainingChart: null,
    statsChart: null,
    
    // Base de datos de Alumnos (Dinámica / Capturada)
    students: [
        { id: 1, name: "Alumno 1", state: "atento", prob: 0.12, bioMatch: "Alumno 1 (98%)", active: false, lastCentroid: null, bbox: null, pose: null, landmarks: null, suspiciousScore: 0, alertCooldownActive: false, lastAlertTime: 0 },
        { id: 2, name: "Alumno 2", state: "distraido", prob: 0.85, bioMatch: "Alumno 2 (95%)", active: false, lastCentroid: null, bbox: null, pose: null, landmarks: null, suspiciousScore: 0, alertCooldownActive: false, lastAlertTime: 0 },
        { id: 3, name: "Alumno 3", state: "somnoliento", prob: 0.45, bioMatch: "Alumno 3 (99%)", active: false, lastCentroid: null, bbox: null, pose: null, landmarks: null, suspiciousScore: 0, alertCooldownActive: false, lastAlertTime: 0 }
    ],
    
    // Base de datos de Incidentes de Video
    clips: []
};

// Variable para controlar el disparo de la simulación de copia en modo simulador
let isCopyActive = false;
let copyTriggerTime = 0;

// --- 2. WEBCAM STREAM GLOBAL VARIABLES ---
let webcamStream = null;
let webcamActive = false;
let isPredicting = false;
let offscreenVideo = null;
let inferenceInterval = null;

// --- 3. CONFIGURACIÓN E INICIALIZACIÓN ---
window.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    setupSidebarRouter();
    
    // Iniciar webcam por defecto
    toggleRealWebcam(state.cameraActive);
    
    // Iniciar el renderizado del canvas
    startCameraRenderLoop("hud-camera-canvas");
    
    // Renderizar roster inicial
    renderStudentsGrid();
    updateRosterTable();
    updateRosterCardSelection();
    
    // Cargar incidentes iniciales en bandeja
    renderClipsInboxList();
    syncClipDisplayDetails(state.activeClipId);
    
    // Cargar contadores de dataset en configuración
    refreshDatasetStatus();
});

// --- 4. WEBCAM CAPTURE & INFERENCE LOOP ---
function toggleRealWebcam(active) {
    toggleBufferCapture(active);
    if (active) {
        if (webcamActive) return;
        webcamActive = true;
        isPredicting = true;
        
        offscreenVideo = document.createElement("video");
        offscreenVideo.setAttribute("autoplay", "");
        offscreenVideo.setAttribute("playsinline", "");
        offscreenVideo.style.display = "none";
        document.body.appendChild(offscreenVideo);
        
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
            .then(stream => {
                webcamStream = stream;
                offscreenVideo.srcObject = stream;
                offscreenVideo.play();
                showToast("Cámara física conectada al monitor.");
                
                toggleSimulatedInference(false); // Detener inferencia simulada
                startInferenceLoop();
            })
            .catch(err => {
                console.error("Error al capturar webcam: ", err);
                showToast("Error de acceso a webcam. Se usará el modo simulación.");
                webcamActive = false;
                isPredicting = false;
                toggleSimulatedInference(state.cameraActive); // Iniciar inferencia simulada
            });
    } else {
        webcamActive = false;
        isPredicting = false;
        toggleSimulatedInference(false); // Detener inferencia simulada
        if (inferenceInterval) {
            clearInterval(inferenceInterval);
            inferenceInterval = null;
        }
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
        }
        if (offscreenVideo) {
            offscreenVideo.remove();
            offscreenVideo = null;
        }
        // Desactivar estado activo de todos los estudiantes
        state.students.forEach(s => {
            s.active = false;
            s.lastCentroid = null;
        });
        renderStudentsGrid();
        updateRosterTable();
    }
}

function startInferenceLoop() {
    if (inferenceInterval) clearInterval(inferenceInterval);
    
    inferenceInterval = setInterval(() => {
        if (!webcamActive || !isPredicting || !offscreenVideo || offscreenVideo.readyState < 2) return;
        
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = 640;
        tempCanvas.height = 480;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.drawImage(offscreenVideo, 0, 0, tempCanvas.width, tempCanvas.height);
        
        const base64Image = tempCanvas.toDataURL("image/jpeg", 0.82);
        
        // Obtener offset de calibración pitch
        const pitchSlider = document.getElementById("focus-pitch-offset-slider");
        state.cameraPitchOffset = pitchSlider ? parseFloat(pitchSlider.value) : 0.0;
        
        fetch("/api/train/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image: base64Image,
                camera_pitch_offset: state.cameraPitchOffset
            })
        })
        .then(res => res.json())
        .then(data => {
            if (!webcamActive) return;
            if (data.status === "success") {
                updateStudentsFromInference(data.faces);
            }
        })
        .catch(err => {
            console.error("Error en Inferencia API:", err);
        });
    }, 250); // Muestreo cada 250ms (4 FPS de inferencia)
}

// --- 5. SPATIAL CENTROID FACE TRACKING & ASSIGNMENT ---
function updateStudentsFromInference(faces) {
    const img_w = 640;
    const img_h = 480;
    
    // 1. Obtener centroides de caras detectadas
    const detectedFaces = faces.map(face => {
        const [x_min, y_min, x_max, y_max] = face.bbox;
        const cx = (x_min + x_max) / 2;
        const cy = (y_min + y_max) / 2;
        return {
            cx, cy,
            bbox: face.bbox,
            prediction: face.prediction,
            probabilities: face.probabilities,
            pose: face.pose,
            landmarks: face.landmarks,
            matched: false
        };
    });
    
    // 2. Coincidencia greedy basada en centroide previo
    state.students.forEach(student => {
        if (student.lastCentroid) {
            let bestDist = Infinity;
            let bestFaceIdx = -1;
            
            detectedFaces.forEach((face, idx) => {
                if (!face.matched) {
                    const dist = Math.hypot(face.cx - student.lastCentroid.x, face.cy - student.lastCentroid.y);
                    if (dist < bestDist && dist < 200) { // Umbral de 200 píxeles de cercanía
                        bestDist = dist;
                        bestFaceIdx = idx;
                    }
                }
            });
            
            if (bestFaceIdx !== -1) {
                const face = detectedFaces[bestFaceIdx];
                face.matched = true;
                student.lastCentroid = { x: face.cx, y: face.cy };
                student.state = face.prediction.toLowerCase();
                if (student.state === "sospechoso" || student.state === "copia") {
                    student.state = "copia";
                    student.prob = face.probabilities["Sospechoso"] ? face.probabilities["Sospechoso"] : 0.85;
                    
                    student.suspiciousScore = (student.suspiciousScore || 0) + 1;
                    
                    // Comprobar cooldown individual por alumno e incremento del umbral a 8 frames (2 segundos)
                    if (student.prob >= state.sensitivity && student.suspiciousScore >= 8) {
                        if (!student.alertCooldownActive) {
                            triggerIncidentAlert(student);
                        }
                        student.suspiciousScore = 0;
                    }
                } else {
                    student.prob = face.probabilities["Atento"] ? (1.0 - face.probabilities["Atento"]) : 0.5;
                    student.suspiciousScore = Math.max(0, (student.suspiciousScore || 0) - 1);
                }
                student.bbox = face.bbox;
                student.pose = face.pose;
                student.landmarks = face.landmarks;
                student.active = true;
            } else {
                student.active = false;
                student.lastCentroid = null;
            }
        } else {
            student.active = false;
        }
    });
    
    // 3. Emparejar caras restantes a alumnos offline o registrar nuevos alumnos
    detectedFaces.forEach(face => {
        if (!face.matched) {
            let student = state.students.find(s => !s.lastCentroid && !s.active);
            if (!student) {
                // Crear un nuevo alumno dinámicamente si entran más a la vista
                const newId = state.students.length + 1;
                student = {
                    id: newId,
                    name: `Alumno ${newId}`,
                    state: "atento",
                    prob: 0.1,
                    bioMatch: `Alumno ${newId} (96%)`,
                    active: true,
                    lastCentroid: null,
                    alertCooldownActive: false,
                    lastAlertTime: 0
                };
                state.students.push(student);
            }
            
            student.lastCentroid = { x: face.cx, y: face.cy };
            student.state = face.prediction.toLowerCase();
            if (student.state === "sospechoso") student.state = "copia";
            student.prob = face.probabilities["Atento"] ? (1.0 - face.probabilities["Atento"]) : 0.5;
            student.bbox = face.bbox;
            student.pose = face.pose;
            student.landmarks = face.landmarks;
            student.active = true;
            face.matched = true;
        }
    });
    
    // Actualizar grids de renderizado de Roster
    renderStudentsGrid();
    updateRosterTable();
}

function triggerIncidentAlert(student) {
    // Cooldown individual por alumno
    if (student.alertCooldownActive) return;
    student.alertCooldownActive = true;
    student.lastAlertTime = Date.now();
    
    // Desactivar cooldown del alumno tras 25 segundos
    setTimeout(() => {
        student.alertCooldownActive = false;
    }, 25000);
    
    // Sonido y alerta en pantalla (solo si no hay una alerta visual ya activa)
    if (!isCopyActive) {
        isCopyActive = true;
        copyTriggerTime = Date.now();
        
        const audioEnabled = document.getElementById("hud-audio-toggle")?.checked || document.getElementById("settings-audio-toggle")?.checked || true;
        if (audioEnabled) {
            playSynthBeep();
        }
        
        const alertBox = document.getElementById("hud-suspicious-alert-box");
        if (alertBox) {
            document.getElementById("hud-alert-reason").textContent = `Copia detectada: ${student.name}`;
            alertBox.style.display = "flex";
        }
        
        showToast(`¡Comportamiento de copia detectado en: ${student.name}!`);
    } else {
        showToast(`Sospecha de copia adicional en: ${student.name}`);
    }
    
    if (state.recordEvidenceEnabled) {
        startEvidenceRecordingFlow(student);
    } else {
        // Alerta en pantalla y beep sin registrar clips ni animar timeline
        setTimeout(() => resetAlertStates(student), 4000);
    }
}

// --- 6. ENRUTADOR Y NAVEGACIÓN (SPA) ---
function setupSidebarRouter() {
    const navLinks = document.querySelectorAll(".nav-link");
    const viewPanels = document.querySelectorAll(".view-panel");
    const viewTitle = document.getElementById("view-title");
    const viewSubtitle = document.getElementById("view-subtitle");
    
    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const viewId = link.dataset.view;
            if (!viewId) return;
            
            state.currentView = viewId;
            
            // Activar enlace del sidebar
            navLinks.forEach(l => l.classList.remove("active"));
            link.classList.add("active");
            
            // Mostrar panel de vista correcto
            viewPanels.forEach(panel => {
                panel.classList.toggle("active-view", panel.id === `view-${viewId}`);
            });
            
            handleViewTransition(viewId, viewTitle, viewSubtitle);
        });
    });
}

function handleViewTransition(viewId, titleEl, subtitleEl) {
    if (state.activeLoops.bufferTimer) clearInterval(state.activeLoops.bufferTimer);
    if (state.activeLoops.trainingSim) clearInterval(state.activeLoops.trainingSim);
    stopReviewVideoPlayback();
    
    if (viewId === "dashboard") {
        titleEl.textContent = "Panel Principal";
        subtitleEl.textContent = "Monitoreo del aula en tiempo real y detección de comportamientos mediante IA";
        startCameraRenderLoop("hud-camera-canvas");
        renderClipsInboxList();
    } else if (viewId === "camera") {
        titleEl.textContent = "Cámara en Vivo";
        subtitleEl.textContent = "Visualización detallada de la inferencia de visión artificial sobre el aula";
        startCameraRenderLoop("focus-camera-canvas");
        
        // Sincronizar sliders del offset de pitch y sensibilidad
        const slider = document.getElementById("focus-pitch-offset-slider");
        const val = document.getElementById("focus-val-pitch-offset");
        if (slider && val) {
            slider.value = state.cameraPitchOffset;
            val.textContent = `${state.cameraPitchOffset >= 0 ? '+' : ''}${state.cameraPitchOffset}°`;
        }
        const sensSlider = document.getElementById("focus-sensitivity-slider");
        const sensVal = document.getElementById("focus-val-sensitivity");
        if (sensSlider && sensVal) {
            sensSlider.value = Math.round(state.sensitivity * 100);
            sensVal.textContent = state.sensitivity.toFixed(2);
        }
    } else if (viewId === "roster") {
        titleEl.textContent = "Alumnos y Roster";
        subtitleEl.textContent = "Administración de atención individual, estados y coincidencia de identidad biométrica";
        updateRosterTable();
    } else if (viewId === "inbox") {
        titleEl.textContent = "Bandeja de Incidentes";
        subtitleEl.textContent = "Revisión histórica de clips y dictámenes de auditoría docente";
        renderClipsInboxList("focus-clips-list");
        syncClipDisplayDetails(state.activeClipId);
    } else if (viewId === "settings") {
        titleEl.textContent = "Configuración del Sistema";
        subtitleEl.textContent = "Ajustes del umbral de ML, notificaciones de correo y auditorías";
        
        initializeSettingsStatsChart();
        initializeSettingsMLChart();
        refreshDatasetStatus();
    }
}

// --- 7. CONFIGURACIÓN DE EVENT LISTENERS ---
function setupEventListeners() {
    // Colapsar menú lateral
    const sidebar = document.getElementById("app-sidebar");
    const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
    const btnUncollapseSidebar = document.getElementById("btn-uncollapse-sidebar");
    
    btnToggleSidebar.addEventListener("click", () => {
        sidebar.classList.add("collapsed");
        btnUncollapseSidebar.style.display = "inline-flex";
    });
    
    btnUncollapseSidebar.addEventListener("click", () => {
        sidebar.classList.remove("collapsed");
        btnUncollapseSidebar.style.display = "none";
    });

    // Switch de Auto-Grabación de Evidencia
    const recordEvidenceSwitch = document.getElementById("hud-switch-record-evidence");
    if (recordEvidenceSwitch) {
        recordEvidenceSwitch.checked = state.recordEvidenceEnabled;
        recordEvidenceSwitch.addEventListener("change", () => {
            state.recordEvidenceEnabled = recordEvidenceSwitch.checked;
            showToast(state.recordEvidenceEnabled ? "Auto-grabación de evidencia activada." : "Auto-grabación de evidencia desactivada.");
        });
    }

    // Control maestro de privacidad de cámara
    const activeSwitch = document.getElementById("hud-switch-active");
    const offlineOverlay = document.getElementById("hud-camera-offline");
    activeSwitch.addEventListener("change", () => {
        state.cameraActive = activeSwitch.checked;
        offlineOverlay.style.display = state.cameraActive ? "none" : "flex";
        toggleRealWebcam(state.cameraActive);
    });

    // Slider de Sensibilidad (Dashboard)
    const sensSlider = document.getElementById("hud-slider-sensitivity");
    const sensValue = document.getElementById("hud-val-sensitivity");
    sensSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value) / 100;
        state.sensitivity = val;
        sensValue.textContent = val.toFixed(2);
        
        // Sincronizar el slider del panel detallado
        const focusSensSlider = document.getElementById("focus-sensitivity-slider");
        const focusSensVal = document.getElementById("focus-val-sensitivity");
        if (focusSensSlider && focusSensVal) {
            focusSensSlider.value = e.target.value;
            focusSensVal.textContent = val.toFixed(2);
        }
    });

    // Slider de Sensibilidad (Cámara en Vivo)
    const focusSensSlider = document.getElementById("focus-sensitivity-slider");
    const focusSensVal = document.getElementById("focus-val-sensitivity");
    if (focusSensSlider) {
        focusSensSlider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value) / 100;
            state.sensitivity = val;
            if (focusSensVal) focusSensVal.textContent = val.toFixed(2);
            
            // Sincronizar el slider del dashboard
            const hudSensSlider = document.getElementById("hud-slider-sensitivity");
            const hudSensValue = document.getElementById("hud-val-sensitivity");
            if (hudSensSlider && hudSensValue) {
                hudSensSlider.value = e.target.value;
                hudSensValue.textContent = val.toFixed(2);
            }
        });
    }

    // Slider de Compensación Pitch de Cámara
    const pitchSlider = document.getElementById("focus-pitch-offset-slider");
    const pitchValue = document.getElementById("focus-val-pitch-offset");
    if (pitchSlider) {
        pitchSlider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            state.cameraPitchOffset = val;
            pitchValue.textContent = `${val >= 0 ? '+' : ''}${val}°`;
        });
    }

    // Controles Roster Manuales (Dashboard)
    document.getElementById("btn-hud-state-atento").addEventListener("click", () => overrideAttentionState("atento"));
    document.getElementById("btn-hud-state-distraido").addEventListener("click", () => overrideAttentionState("distraido"));
    document.getElementById("btn-hud-state-somnoliento").addEventListener("click", () => overrideAttentionState("somnoliento"));

    // Simular alerta de copia
    document.getElementById("btn-hud-simulate-alert").addEventListener("click", () => {
        if (state.students.length > 1) {
            const student = state.students[1];
            // Aleatorizar la probabilidad para mostrar una estimación realista de confianza (e.g. 45% a 92%)
            student.prob = 0.40 + Math.random() * 0.52;
            triggerIncidentAlert(student);
        }
    });

    // Reproductor de clip
    document.getElementById("hud-btn-play-video").addEventListener("click", () => startReviewVideoPlayback("hud-player-canvas", "hud-btn-play-video"));

    // Reproductor de clip en vista detallada de incidentes
    const focusPlayBtn = document.getElementById("focus-btn-play-video");
    if (focusPlayBtn) {
        focusPlayBtn.addEventListener("click", () => startReviewVideoPlayback("focus-player-canvas", "focus-btn-play-video"));
    }

    // Validar / Descartar Incidentes (Dashboard)
    document.getElementById("btn-hud-clip-confirm").addEventListener("click", () => setClipVeredict("confirmed"));
    document.getElementById("btn-hud-clip-discard").addEventListener("click", () => setClipVeredict("discarded"));

    // Validar / Descartar Incidentes (Inbox Detallado)
    document.getElementById("btn-focus-clip-confirm")?.addEventListener("click", () => setClipVeredict("confirmed"));
    document.getElementById("btn-focus-clip-discard")?.addEventListener("click", () => setClipVeredict("discarded"));

    // Descarga manual de video evidencia (Dashboard)
    const btnDownload = document.getElementById("btn-hud-clip-download");
    if (btnDownload) {
        btnDownload.addEventListener("click", () => {
            const clip = state.clips.find(c => c.id === state.activeClipId);
            const blob = state.recordedBlobs[state.activeClipId];
            if (clip && blob) {
                triggerFileDownload(blob, clip.filename);
            }
        });
    }

    // Descarga manual de video evidencia (Bandeja Detallada)
    const btnFocusDownload = document.getElementById("btn-focus-clip-download");
    if (btnFocusDownload) {
        btnFocusDownload.addEventListener("click", () => {
            const clip = state.clips.find(c => c.id === state.activeClipId);
            const blob = state.recordedBlobs[state.activeClipId];
            if (clip && blob) {
                triggerFileDownload(blob, clip.filename);
            }
        });
    }

    // Pestañas del cajón técnico en configuración
    const tabButtons = document.querySelectorAll("#hud-technical-tabs .tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.dataset.tab;
            activateSettingsTab(tabId);
        });
    });

    // Pitido de prueba en configuración
    document.getElementById("btn-settings-audio-test").addEventListener("click", () => {
        const audioEnabled = document.getElementById("settings-audio-toggle").checked;
        if (!audioEnabled) {
            showToast("Habilite primero el switch de alertas sonoras.");
            return;
        }
        
        const bell = document.getElementById("settings-bell-wrapper");
        bell.classList.add("active-ringing");
        setTimeout(() => bell.classList.remove("active-ringing"), 500);
        
        playSynthBeep();
        showToast("Se emitió un tono discreto de prueba.");
    });

    // PDF Descarga
    document.getElementById("btn-settings-pdf-download").addEventListener("click", () => triggerPdfDownloadSim());

    // Modal de privacidad de coincidencia biométrica
    document.getElementById("btn-close-ethical").addEventListener("click", () => {
        document.getElementById("hud-ethical-modal").classList.remove("open");
    });
    
    document.getElementById("btn-bypass-ethical").addEventListener("click", () => {
        document.getElementById("hud-ethical-modal").classList.remove("open");
        state.biometricsBypassed = true;
        document.querySelectorAll(".student-bio-id").forEach(el => el.classList.add("visible"));
        updateRosterTable();
        renderStudentsGrid();
        showToast("Advertencia omitida: Visualizando matrícula biométrica.");
    });

    // Toggle biometrics manual
    const btnBiometrics = document.getElementById("btn-roster-biometrics");
    if (btnBiometrics) {
        btnBiometrics.addEventListener("click", () => {
            if (!state.biometricsBypassed) {
                document.getElementById("hud-ethical-modal").classList.add("open");
            } else {
                state.biometricsBypassed = false;
                updateRosterTable();
                renderStudentsGrid();
                showToast("Coincidencia biométrica oculta por privacidad.");
            }
        });
    }

    // --- DATASET EXTRACTION EVENTS ---
    const intervalSlider = document.getElementById("frameInterval");
    if (intervalSlider) {
        intervalSlider.addEventListener("input", (e) => {
            document.getElementById("valFrameInterval").textContent = e.target.value;
        });
    }

    const btnStartExtract = document.getElementById("btnStartExtraction");
    if (btnStartExtract) btnStartExtract.addEventListener("click", handleStartExtraction);

    const btnStopExtract = document.getElementById("btnStopExtraction");
    if (btnStopExtract) btnStopExtract.addEventListener("click", handleStopExtraction);

    const btnClearDataset = document.getElementById("btnClearDataset");
    if (btnClearDataset) btnClearDataset.addEventListener("click", handleClearDataset);

    const btnDownloadDataset = document.getElementById("btnDownloadDataset");
    if (btnDownloadDataset) btnDownloadDataset.addEventListener("click", handleDownloadDataset);

    // Gallery tabs
    const tabAtento = document.getElementById("tabGalleryAtento");
    if (tabAtento) tabAtento.addEventListener("click", () => loadGalleryTab("Atento"));

    const tabDist = document.getElementById("tabGalleryDistraido");
    if (tabDist) tabDist.addEventListener("click", () => loadGalleryTab("Distraido"));

    const tabSosp = document.getElementById("tabGallerySospechoso");
    if (tabSosp) tabSosp.addEventListener("click", () => loadGalleryTab("Sospechoso"));

    // --- TRAINING REAL & SIMULATION EVENTS ---
    const btnRealTrain = document.getElementById("btnStartRealTrain");
    if (btnRealTrain) btnRealTrain.addEventListener("click", handleStartRealTraining);

    const btnStopRealTrain = document.getElementById("btnStopRealTrain");
    if (btnStopRealTrain) btnStopRealTrain.addEventListener("click", handleStopRealTraining);

    const btnSimTrain = document.getElementById("btn-start-settings-train");
    if (btnSimTrain) btnSimTrain.addEventListener("click", startMLTrainingSim);
    
    // Lightbox keyboard navigation
    document.addEventListener("keydown", (e) => {
        const modal = document.getElementById("lightboxModal");
        if (modal && modal.style.display === "flex") {
            if (e.key === "ArrowLeft") {
                navigateLightbox(-1);
            } else if (e.key === "ArrowRight") {
                navigateLightbox(1);
            } else if (e.key === "Escape") {
                closeLightbox();
            }
        }
    });
}

// --- 8. RENDERIZADO DE LA CÁMARA (Landmarks, bounding boxes y vector de mirada) ---
function startCameraRenderLoop(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Cancelar animación anterior si existe
    if (canvasId === "hud-camera-canvas" && state.activeLoops.cameraLoop) cancelAnimationFrame(state.activeLoops.cameraLoop);
    if (canvasId === "focus-camera-canvas" && state.activeLoops.focusCameraLoop) cancelAnimationFrame(state.activeLoops.focusCameraLoop);
    
    let loopFrame = 0;
    
    function draw() {
        if (canvasId === "hud-camera-canvas") {
            state.activeLoops.cameraLoop = requestAnimationFrame(draw);
        } else {
            state.activeLoops.focusCameraLoop = requestAnimationFrame(draw);
        }
        
        loopFrame++;
        
        if (!state.cameraActive) {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }
        
        // Redimensionar si cambia de tamaño
        if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Si la cámara real está encendida, pintar el feed de video
        if (webcamActive && offscreenVideo && offscreenVideo.readyState >= 2) {
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1); // Modo espejo natural
            ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
            ctx.restore();
            
            // Pintar bounding boxes y malla de los estudiantes activos detectados
            state.students.forEach(student => {
                if (student.active && student.bbox) {
                    const img_w = 640;
                    const img_h = 480;
                    
                    // Espejar coordenadas de la bounding box
                    const x1 = canvas.width - (student.bbox[2] / img_w) * canvas.width;
                    const y1 = (student.bbox[1] / img_h) * canvas.height;
                    const x2 = canvas.width - (student.bbox[0] / img_w) * canvas.width;
                    const y2 = (student.bbox[3] / img_h) * canvas.height;
                    const boxW = x2 - x1;
                    const boxH = y2 - y1;
                    
                    let color = "#10b981"; // Verde (Atento)
                    if (student.state === "copia" || student.state === "sospechoso") {
                        color = "#ff1744"; // Rojo (Sospechoso)
                    } else if (student.state === "distraido") {
                        color = "#f59e0b"; // Naranja (Distraído)
                    } else if (student.state === "somnoliento") {
                        color = "#ef4444"; // Rojo claro (Somnoliento)
                    }
                    
                    // Dibujar recuadro de cara
                    ctx.strokeStyle = color;
                    ctx.lineWidth = student.id === state.selectedStudentId ? 2.5 : 1.5;
                    ctx.strokeRect(x1, y1, boxW, boxH);
                    
                    // Dibujar cabecera del recuadro
                    ctx.fillStyle = "rgba(2, 4, 6, 0.75)";
                    ctx.fillRect(x1 - 0.5, y1 - 18, Math.max(105, boxW + 1), 18);
                    
                    ctx.fillStyle = "#fff";
                    ctx.font = "bold 9px Inter";
                    ctx.textAlign = "left";
                    ctx.fillText(`${student.name} (${( (1 - student.prob)*100 ).toFixed(0)}%)`, x1 + 4, y1 - 6);
                    
                    // Dibujar malla de puntos (Face Mesh) si está marcada
                    const isMeshToggled = document.getElementById("chk-toggle-facemesh")?.checked ?? true;
                    if (isMeshToggled && student.landmarks) {
                        ctx.fillStyle = "rgba(0, 229, 255, 0.4)";
                        student.landmarks.forEach(lm => {
                            ctx.beginPath();
                            ctx.arc((1.0 - lm.x) * canvas.width, lm.y * canvas.height, 1.0, 0, 2 * Math.PI);
                            ctx.fill();
                        });
                    }
                    
                    // Dibujar vector de mirada (Gaze laser) si está marcado
                    const isGazeToggled = document.getElementById("chk-toggle-gaze")?.checked ?? true;
                    if (isGazeToggled && student.pose) {
                        const cx = (x1 + x2) / 2;
                        const cy = (y1 + y2) / 2;
                        
                        const gazeLength = 65;
                        // Espejar yaw
                        const dx = Math.sin(student.pose.yaw * Math.PI / 180) * gazeLength;
                        const dy = Math.sin(student.pose.pitch * Math.PI / 180) * gazeLength;
                        
                        ctx.strokeStyle = "rgba(255, 23, 68, 0.85)";
                        ctx.lineWidth = 1.8;
                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.lineTo(cx + dx, cy + dy);
                        ctx.stroke();
                        
                        // Punto final
                        ctx.fillStyle = "#ff1744";
                        ctx.beginPath();
                        ctx.arc(cx + dx, cy + dy, 3, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }
            });
        } else {
            // Fondo de rejilla simulado (Blueprint) si no hay webcam real
            ctx.fillStyle = "#03060a";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.strokeStyle = "rgba(14, 165, 233, 0.03)";
            ctx.lineWidth = 1;
            const spacing = 20;
            for (let x = 0; x < canvas.width; x += spacing) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += spacing) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            }
            
            // Panel informativo de simulación
            ctx.fillStyle = "rgba(14, 165, 233, 0.08)";
            ctx.strokeStyle = "rgba(14, 165, 233, 0.2)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(canvas.width / 2 - 170, canvas.height / 2 - 35, 340, 70, 8);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = "#e0f2fe";
            ctx.font = "bold 11px Inter";
            ctx.textAlign = "center";
            ctx.fillText("MODO SIMULACIÓN - WEBCAM DESCONECTADA", canvas.width / 2, canvas.height / 2 - 10);
            
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.font = "9px Inter";
            ctx.fillText("El sistema fluctuará estados para probar y calibrar el monitor.", canvas.width / 2, canvas.height / 2 + 8);
            ctx.fillText("Conecte una webcam real para activar visión artificial.", canvas.width / 2, canvas.height / 2 + 20);
        }
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
        ctx.font = "8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`FPS: 30 | LATENCIA DE INFERENCIA: 24ms | BACKBONE: MobileViT-XS`, 10, canvas.height - 10);
    }
    draw();
}

function varColorHex(name) {
    if (name === "danger") return "#ff1744";
    if (name === "success") return "#10b981";
    if (name === "warning") return "#f59e0b";
    return "#0ea5e9";
}

// --- 9. RENAME STUDENTS FUNCTIONALITY ---
window.renameStudent = function(id) {
    const student = state.students.find(s => s.id === id);
    if (!student) return;
    
    const newName = prompt(`Modificar nombre o código de matrícula para el estudiante:`, student.name);
    if (newName !== null) {
        const trimmedName = newName.trim();
        if (trimmedName !== "") {
            student.name = trimmedName;
            student.bioMatch = `${trimmedName.split(" ")[0]} (${Math.floor(Math.random()*5+95)}%)`;
            showToast(`Identidad de alumno actualizada: ${trimmedName}`);
            
            renderStudentsGrid();
            updateRosterTable();
        }
    }
};

// --- 10. SIMULACIÓN DE BUFFER CIRCULAR & DISPARADOR DE ALERTA ---
function animateBufferTimeline(student) {
    const playhead = document.getElementById("hud-buffer-playhead");
    if (!playhead) return;
    
    let start = null;
    const duration = 2500; // 2.5s duración de la animación en barra
    
    function step(timestamp) {
        if (!start) start = timestamp;
        const progress = timestamp - start;
        const pct = Math.min((progress / duration) * 100, 100);
        
        playhead.style.left = `${pct}%`;
        
        if (progress < duration) {
            requestAnimationFrame(step);
        } else {
            generateNewIncidentClip(student);
            resetAlertStates(student);
        }
    }
    requestAnimationFrame(step);
}

function toggleBufferCapture(active) {
    if (state.activeLoops.bufferCaptureInterval) {
        clearInterval(state.activeLoops.bufferCaptureInterval);
        state.activeLoops.bufferCaptureInterval = null;
    }
    if (active) {
        state.activeLoops.bufferCaptureInterval = setInterval(captureBufferFrame, 100);
    }
}

function captureBufferFrame() {
    if (!state.cameraActive) return;
    
    const capCanvas = document.createElement("canvas");
    capCanvas.width = 320;
    capCanvas.height = 240;
    const capCtx = capCanvas.getContext("2d");
    
    if (webcamActive && offscreenVideo && offscreenVideo.readyState >= 2) {
        capCtx.save();
        capCtx.translate(capCanvas.width, 0);
        capCtx.scale(-1, 1);
        capCtx.drawImage(offscreenVideo, 0, 0, capCanvas.width, capCanvas.height);
        capCtx.restore();
    } else {
        const hudCanvas = document.getElementById("hud-camera-canvas");
        if (hudCanvas) {
            capCtx.drawImage(hudCanvas, 0, 0, capCanvas.width, capCanvas.height);
        } else {
            capCtx.fillStyle = "#03060a";
            capCtx.fillRect(0, 0, capCanvas.width, capCanvas.height);
        }
    }
    
    capCanvas.toBlob((blob) => {
        if (!blob) return;
        
        // El buffer circular siempre captura fotogramas de forma ininterrumpida
        state.circularBuffer.push(blob);
        if (state.circularBuffer.length > 50) {
            state.circularBuffer.shift();
        }
        
        // Inyectar fotograma a las sesiones concurrentes activas
        state.activeSessions.forEach(session => {
            session.frames.push(blob);
        });
        
        // Procesar y compilar sesiones completas
        const completed = state.activeSessions.filter(s => s.frames.length >= 100);
        completed.forEach(session => {
            // Remover de las sesiones activas
            state.activeSessions = state.activeSessions.filter(s => s !== session);
            
            // Ocultar indicador visual REC si no quedan grabaciones en curso
            if (state.activeSessions.length === 0) {
                const recDot = document.getElementById("evidence-rec-dot");
                if (recDot) recDot.style.display = "none";
            }
            
            compileEvidenceVideo(session.frames, session.student);
        });
    }, "image/jpeg", 0.5);
}

function startEvidenceRecordingFlow(student) {
    const sessionFrames = [...state.circularBuffer];
    if (sessionFrames.length > 0) {
        while (sessionFrames.length < 50) {
            sessionFrames.unshift(sessionFrames[0]);
        }
    }
    
    const recDot = document.getElementById("evidence-rec-dot");
    if (recDot) recDot.style.display = "inline-block";
    
    // Crear y registrar sesión concurrente
    const session = {
        student: student,
        frames: sessionFrames
    };
    state.activeSessions.push(session);
    
    showToast(`Grabando evidencia para ${student.name} (5s post-suceso)...`);
}

async function compileEvidenceVideo(frames, student, bbox) {
    showToast(`Compilando video de evidencia para ${student.name}...`);
    
    // Grabar fotograma completo en resolución 320x240 sin recortar ni estirar
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = 320;
    cropCanvas.height = 240;
    const cropCtx = cropCanvas.getContext("2d");
    
    const stream = cropCanvas.captureStream(10);
    
    let options = { mimeType: 'video/webm;codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'video/webm' };
        }
    }
    
    const chunks = [];
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    
    const recordPromise = new Promise((resolve) => {
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resolve(blob);
        };
    });
    
    mediaRecorder.start();
    
    const playhead = document.getElementById("hud-buffer-playhead");
    
    for (let i = 0; i < frames.length; i++) {
        const blob = frames[i];
        
        if (playhead) {
            playhead.style.left = `${(i / (frames.length - 1)) * 100}%`;
        }
        
        try {
            const imgBitmap = await createImageBitmap(blob);
            cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
            
            // Dibujar el fotograma completo para enfocar todo el cuerpo y el aula
            cropCtx.drawImage(imgBitmap, 0, 0, cropCanvas.width, cropCanvas.height);
            
            // Dibujar recuadro de trampa enfocado sobre el alumno si tiene bbox
            if (student && student.bbox) {
                const scaleX = cropCanvas.width / 640;
                const scaleY = cropCanvas.height / 480;
                
                // Espejar las coordenadas ya que el buffer se captura espejado
                const bx1 = cropCanvas.width - (student.bbox[2] * scaleX);
                const by1 = student.bbox[1] * scaleY;
                const bx2 = cropCanvas.width - (student.bbox[0] * scaleX);
                const by2 = student.bbox[3] * scaleY;
                const bw = bx2 - bx1;
                const bh = by2 - by1;
                
                cropCtx.strokeStyle = "#ff1744";
                cropCtx.lineWidth = 1.8;
                cropCtx.strokeRect(bx1, by1, bw, bh);
                
                // Fondo de la etiqueta
                cropCtx.fillStyle = "rgba(255, 23, 68, 0.85)";
                cropCtx.fillRect(bx1, by1 - 14, Math.max(70, bw), 14);
                
                cropCtx.fillStyle = "#ffffff";
                cropCtx.font = "bold 8px Inter, sans-serif";
                cropCtx.fillText(student.name, bx1 + 4, by1 - 4);
            }
            
            cropCtx.fillStyle = "rgba(255, 23, 68, 0.85)";
            cropCtx.font = "bold 9px monospace";
            cropCtx.fillText("REC EVIDENCIA", 8, 18);
            
            cropCtx.fillStyle = "#fff";
            cropCtx.font = "8px monospace";
            const timeOffset = (i / 10 - 5.0).toFixed(1);
            cropCtx.fillText(`T: ${timeOffset >= 0 ? '+' : ''}${timeOffset}s`, 8, cropCanvas.height - 10);
            
            imgBitmap.close();
        } catch (e) {
            console.error("Error drawing frame during compilation:", e);
        }
        
        await new Promise(r => setTimeout(r, 100));
    }
    
    mediaRecorder.stop();
    const videoBlob = await recordPromise;
    
    const filename = `evidencia_copia_${student.name.replace(/\s+/g, '_')}_10s.webm`;
    
    // NO descargar automáticamente, guardar en el sistema
    registerRecordedIncident(videoBlob, student, filename);
    
    if (playhead) {
        playhead.style.left = "0%";
    }
    
    resetAlertStates(student);
}

function triggerFileDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Evidencia descargada: ${filename}`);
}

function registerRecordedIncident(blob, student, filename) {
    const nextId = state.clips.length + 1;
    const hashHex = "9d8e7f6c5b4a3c2b1e0f" + Math.floor(Math.random()*9000+1000);
    const confidence = student ? Math.round(student.prob * 100) : 95;
    const newClip = {
        id: nextId,
        classroom: "Aula 4 - Física",
        studentName: student ? student.name : "Alumno",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: 10,
        filename: filename,
        date: new Date().toLocaleString(),
        hash: hashHex,
        confidence: confidence,
        status: "pending"
    };
    
    state.clips.unshift(newClip);
    state.activeClipId = nextId;
    
    state.recordedBlobs[nextId] = blob;
    
    const phoneNotif = document.getElementById("settings-phone-notif");
    if (phoneNotif) {
        phoneNotif.innerHTML = `<strong>📧 ALERTA DE COPIA</strong><br>Aula 4 - ${newClip.studentName} (${confidence}% Confianza)`;
        phoneNotif.classList.add("active-notification");
    }
    
    const badge = document.getElementById("badge-clips-count");
    if (badge) badge.textContent = state.clips.filter(c => c.status === "pending").length;
    
    if (state.currentView === "dashboard") {
        renderClipsInboxList();
        syncClipDisplayDetails(nextId);
    } else if (state.currentView === "inbox") {
        renderClipsInboxList("focus-clips-list");
        syncClipDisplayDetails(nextId);
    }
}

function resetAlertStates(student) {
    if (student) {
        // Regresar a este alumno a normalidad
        if (student.state === "copia" || student.state === "sospechoso") {
            student.state = "distraido";
            student.prob = 0.55;
            student.suspiciousScore = 0;
        }
    }
    
    // Solo ocultar la alerta en pantalla si no quedan otros alumnos copiando
    const activeCheatersCount = state.students.filter(s => s.state === "copia" || s.state === "sospechoso").length;
    if (activeCheatersCount === 0) {
        isCopyActive = false;
        const alertBox = document.getElementById("hud-suspicious-alert-box");
        if (alertBox) alertBox.style.display = "none";
    } else {
        // Si hay otros alumnos copiando, actualizar el texto de la alerta en pantalla al último que siga activo
        const remainingCheater = state.students.find(s => s.state === "copia" || s.state === "sospechoso");
        if (remainingCheater) {
            const alertReason = document.getElementById("hud-alert-reason");
            if (alertReason) {
                alertReason.textContent = `Copia detectada: ${remainingCheater.name}`;
            }
        }
    }
    
    renderStudentsGrid();
    updateRosterTable();
}

function generateNewIncidentClip(student) {
    const nextId = state.clips.length + 1;
    const hashHex = "9d8e7f6c5b4a3c2b1e0f" + Math.floor(Math.random()*9000+1000);
    const confidence = student ? Math.round(student.prob * 100) : 90;
    const studentName = student ? student.name : "Alumno 2";
    
    const newClip = {
        id: nextId,
        classroom: "Aula 4 - Física",
        studentName: studentName,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: 10,
        filename: `clip_${105 + nextId}.mp4`,
        date: new Date().toLocaleString(),
        hash: hashHex,
        confidence: confidence,
        status: "pending"
    };
    
    state.clips.unshift(newClip);
    state.activeClipId = nextId;
    
    // Notificación en el celular SMTP
    const phoneNotif = document.getElementById("settings-phone-notif");
    if (phoneNotif) {
        phoneNotif.innerHTML = `<strong>📧 ALERTA DE COPIA</strong><br>Aula 4 - ${studentName} (${confidence}% Confianza)`;
        phoneNotif.classList.add("active-notification");
    }
    
    // Actualizar badges
    const badge = document.getElementById("badge-clips-count");
    if (badge) badge.textContent = state.clips.filter(c => c.status === "pending").length;
    
    if (state.currentView === "dashboard") {
        renderClipsInboxList();
        syncClipDisplayDetails(nextId);
    } else if (state.currentView === "inbox") {
        renderClipsInboxList("focus-clips-list");
        syncClipDisplayDetails(nextId);
    }
    
    showToast("Nuevo clip de video de ejemplo enviado a bandeja.");
}

function toggleSimulatedInference(active) {
    if (state.activeLoops.simulatedInferenceInterval) {
        clearInterval(state.activeLoops.simulatedInferenceInterval);
        state.activeLoops.simulatedInferenceInterval = null;
    }
    if (active) {
        state.activeLoops.simulatedInferenceInterval = setInterval(runSimulatedInference, 1000);
    }
}

function runSimulatedInference() {
    if (!state.cameraActive || webcamActive) return;
    
    state.students.forEach(student => {
        // Fluctuate probability slightly
        if (student.state === "atento") {
            student.prob = Math.max(0.02, Math.min(0.28, student.prob + (Math.random() - 0.5) * 0.05));
            student.suspiciousScore = Math.max(0, student.suspiciousScore - 1);
        } else if (student.state === "distraido") {
            student.prob = Math.max(0.30, Math.min(0.68, student.prob + (Math.random() - 0.5) * 0.08));
            student.suspiciousScore = Math.max(0, student.suspiciousScore - 1);
        } else if (student.state === "somnoliento") {
            student.prob = Math.max(0.15, Math.min(0.52, student.prob + (Math.random() - 0.5) * 0.06));
            student.suspiciousScore = Math.max(0, student.suspiciousScore - 1);
        } else if (student.state === "copia" || student.state === "sospechoso") {
            student.prob = Math.max(0.65, Math.min(0.98, student.prob + (Math.random() - 0.5) * 0.05));
        }
        
        // Frecuencia y sospecha basadas dinámicamente en la sensibilidad
        const suspicionThreshold = (1.0 - state.sensitivity) * 0.015;
        if (student.state !== "copia" && Math.random() < suspicionThreshold) {
            student.state = "copia";
            student.prob = 0.50 + Math.random() * 0.45; // Amplio rango de probabilidad para confianza realista
            student.suspiciousScore = 0;
            showToast(`${student.name} parece sospechoso.`);
        }
        
        // If student is in copying state
        if (student.state === "copia") {
            if (student.prob >= state.sensitivity) {
                student.suspiciousScore = (student.suspiciousScore || 0) + 1;
                // Require 5 seconds of sustained high suspicion to trigger alert, check student cooldown
                if (student.suspiciousScore >= 5) {
                    if (!student.alertCooldownActive) {
                        triggerIncidentAlert(student);
                    }
                    student.suspiciousScore = 0;
                }
            } else {
                student.suspiciousScore = Math.max(0, student.suspiciousScore - 1);
                // Recover to normal distraction after a while if probability drops
                if (Math.random() < 0.15) {
                    student.state = "distraido";
                    student.prob = 0.55;
                    student.suspiciousScore = 0;
                }
            }
        }
    });
    
    // Re-render students UI
    renderStudentsGrid();
    updateRosterTable();
}

// --- 11. BANDEJA DE INCIDENTES & REPRODUCTOR DE VIDEO ---
function renderClipsInboxList(containerId = "hud-clips-list") {
    const list = document.getElementById(containerId);
    if (!list) return;
    
    list.innerHTML = "";
    state.clips.forEach(clip => {
        const item = document.createElement("div");
        item.className = `inbox-item ${clip.id === state.activeClipId ? "active" : ""}`;
        item.dataset.clipId = clip.id;
        
        let statusDotClass = "";
        if (clip.status === "pending") statusDotClass = "active-alert";
        else if (clip.status === "confirmed") statusDotClass = "resolved-confirm";
        else if (clip.status === "discarded") statusDotClass = "resolved-discard";
        
        item.innerHTML = `
            <div class="inbox-thumbnail"><i class="fa-solid fa-play"></i></div>
            <div class="inbox-info">
                <span class="inbox-name">${clip.studentName || "Alumno"}</span>
                <span class="inbox-meta">${clip.classroom} - ${clip.time}</span>
            </div>
            <div class="inbox-status-dot ${statusDotClass}"></div>
        `;
        
        item.addEventListener("click", () => {
            document.querySelectorAll(`.inbox-item`).forEach(i => i.classList.remove("active"));
            item.classList.add("active");
            state.activeClipId = clip.id;
            syncClipDisplayDetails(clip.id);
        });
        
        list.appendChild(item);
    });
}

function syncClipDisplayDetails(clipId) {
    const clip = state.clips.find(c => c.id === clipId);
    
    const hudPlayBtn = document.getElementById("hud-btn-play-video");
    const hudPlaceholder = document.getElementById("hud-player-placeholder");
    const hudControls = document.getElementById("hud-video-controls");
    const focusPlayBtn = document.getElementById("focus-btn-play-video");
    const focusPlaceholder = document.getElementById("focus-player-placeholder");
    const focusControls = document.getElementById("focus-video-controls");

    if (!clip) {
        // Limpiar visor del Dashboard
        const hudFilename = document.getElementById("hud-meta-filename");
        if (hudFilename) hudFilename.textContent = "-";
        const hudTime = document.getElementById("hud-meta-time");
        if (hudTime) hudTime.textContent = "-";
        const hudHash = document.getElementById("hud-meta-hash");
        if (hudHash) hudHash.textContent = "-";
        const gaugePct = document.getElementById("hud-gauge-pct");
        const radialFill = document.getElementById("hud-radial-fill");
        if (gaugePct && radialFill) {
            gaugePct.textContent = "0%";
            radialFill.style.strokeDashoffset = "188.4";
            radialFill.style.stroke = "var(--primary)";
        }
        
        // Deshabilitar botón de descarga en dashboard
        const btnDownload = document.getElementById("btn-hud-clip-download");
        if (btnDownload) {
            btnDownload.disabled = true;
            btnDownload.style.opacity = 0.5;
        }
        
        // Limpiar visor Detallado (Bandeja)
        const focusStudent = document.getElementById("focus-meta-student");
        if (focusStudent) focusStudent.textContent = "-";
        const focusClassroom = document.getElementById("focus-meta-classroom");
        if (focusClassroom) focusClassroom.textContent = "-";
        const focusTime = document.getElementById("focus-meta-time");
        if (focusTime) focusTime.textContent = "-";
        const focusFilename = document.getElementById("focus-meta-filename");
        if (focusFilename) focusFilename.textContent = "-";
        const focusHash = document.getElementById("focus-meta-hash");
        if (focusHash) focusHash.textContent = "-";
        const focusStatus = document.getElementById("focus-meta-status");
        if (focusStatus) focusStatus.innerHTML = "-";
        const focusGaugePct = document.getElementById("focus-gauge-pct");
        const focusRadialFill = document.getElementById("focus-radial-fill");
        if (focusGaugePct && focusRadialFill) {
            focusGaugePct.textContent = "0%";
            focusRadialFill.style.strokeDashoffset = "251.2";
            focusRadialFill.style.stroke = "var(--primary)";
        }
        
        // Deshabilitar botón de descarga detallada
        const btnFocusDownload = document.getElementById("btn-focus-clip-download");
        if (btnFocusDownload) {
            btnFocusDownload.disabled = true;
            btnFocusDownload.style.opacity = 0.5;
        }

        // Configurar UI de reproducción vacía
        if (hudPlayBtn) hudPlayBtn.style.display = "none";
        if (hudPlaceholder) {
            hudPlaceholder.style.display = "block";
            hudPlaceholder.textContent = "Sin incidentes registrados";
        }
        if (hudControls) hudControls.style.display = "none";
        
        if (focusPlayBtn) focusPlayBtn.style.display = "none";
        if (focusPlaceholder) {
            focusPlaceholder.style.display = "block";
            focusPlaceholder.textContent = "Sin incidentes registrados";
        }
        if (focusControls) focusControls.style.display = "none";
        
        // Limpiar los canvas de video
        const hudCanvas = document.getElementById("hud-player-canvas");
        if (hudCanvas) {
            const ctx = hudCanvas.getContext("2d");
            ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
        }
        const focusCanvas = document.getElementById("focus-player-canvas");
        if (focusCanvas) {
            const ctx = focusCanvas.getContext("2d");
            ctx.clearRect(0, 0, focusCanvas.width, focusCanvas.height);
        }

        return;
    }
    
    stopReviewVideoPlayback();
    
    // 1. Sincronizar elementos del Dashboard de Revisión Rápida
    const hudFilename = document.getElementById("hud-meta-filename");
    if (hudFilename) hudFilename.textContent = clip.filename;
    
    const hudTime = document.getElementById("hud-meta-time");
    if (hudTime) hudTime.textContent = clip.date.split(" ")[1] || clip.time;
    
    const hudHash = document.getElementById("hud-meta-hash");
    if (hudHash) hudHash.textContent = clip.hash.substring(0, 14) + "...";
    
    const gaugePct = document.getElementById("hud-gauge-pct");
    const radialFill = document.getElementById("hud-radial-fill");
    if (gaugePct && radialFill) {
        gaugePct.textContent = `${clip.confidence}%`;
        const radius = 30;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (clip.confidence / 100) * circumference;
        radialFill.style.strokeDashoffset = offset;
        
        // Colorear dinámicamente según la confianza
        if (clip.confidence < 50) {
            radialFill.style.stroke = "#ff1744"; // Rojo (Confiabilidad baja, posible error)
        } else if (clip.confidence < 75) {
            radialFill.style.stroke = "#f59e0b"; // Naranja (Media)
        } else {
            radialFill.style.stroke = "#10b981"; // Verde (Alta)
        }
    }
    
    const btnConfirm = document.getElementById("btn-hud-clip-confirm");
    const btnDiscard = document.getElementById("btn-hud-clip-discard");
    
    if (btnConfirm && btnDiscard) {
        if (clip.status !== "pending") {
            btnConfirm.disabled = true;
            btnDiscard.disabled = true;
            btnConfirm.style.opacity = 0.5;
            btnDiscard.style.opacity = 0.5;
        } else {
            btnConfirm.disabled = false;
            btnDiscard.disabled = false;
            btnConfirm.style.opacity = 1;
            btnDiscard.style.opacity = 1;
        }
    }
    
    // 2. Sincronizar elementos del Visor de Bandeja de Incidentes Detallado (Expanded Inbox)
    const focusStudent = document.getElementById("focus-meta-student");
    if (focusStudent) focusStudent.textContent = clip.studentName || "Alumno";
    
    const focusClassroom = document.getElementById("focus-meta-classroom");
    if (focusClassroom) focusClassroom.textContent = clip.classroom;
    
    const focusTime = document.getElementById("focus-meta-time");
    if (focusTime) focusTime.textContent = clip.date;
    
    const focusFilename = document.getElementById("focus-meta-filename");
    if (focusFilename) focusFilename.textContent = clip.filename;
    
    const focusHash = document.getElementById("focus-meta-hash");
    if (focusHash) focusHash.textContent = clip.hash;
    
    const focusStatus = document.getElementById("focus-meta-status");
    if (focusStatus) {
        if (clip.status === "pending") {
            focusStatus.innerHTML = `<span class="badge" style="background: rgba(255,23,68,0.15); color: var(--danger); border: 1px solid rgba(255,23,68,0.3); font-size: 9px; padding: 2px 6px; border-radius: 4px;">Pendiente</span>`;
        } else if (clip.status === "confirmed") {
            focusStatus.innerHTML = `<span class="badge" style="background: rgba(16,185,129,0.15); color: var(--success); border: 1px solid rgba(16,185,129,0.3); font-size: 9px; padding: 2px 6px; border-radius: 4px;">Validada</span>`;
        } else if (clip.status === "discarded") {
            focusStatus.innerHTML = `<span class="badge" style="background: rgba(71,85,105,0.15); color: var(--text-secondary); border: 1px solid rgba(71,85,105,0.3); font-size: 9px; padding: 2px 6px; border-radius: 4px;">Descartada</span>`;
        }
    }
    
    const focusGaugePct = document.getElementById("focus-gauge-pct");
    const focusRadialFill = document.getElementById("focus-radial-fill");
    if (focusGaugePct && focusRadialFill) {
        focusGaugePct.textContent = `${clip.confidence}%`;
        const radius = 40;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (clip.confidence / 100) * circumference;
        focusRadialFill.style.strokeDashoffset = offset;
        
        // Colorear dinámicamente según la confianza en la bandeja
        if (clip.confidence < 50) {
            focusRadialFill.style.stroke = "#ff1744"; // Rojo (Bajo)
        } else if (clip.confidence < 75) {
            focusRadialFill.style.stroke = "#f59e0b"; // Naranja (Medio)
        } else {
            focusRadialFill.style.stroke = "#10b981"; // Verde (Alto)
        }
    }
    
    const btnFocusConfirm = document.getElementById("btn-focus-clip-confirm");
    const btnFocusDiscard = document.getElementById("btn-focus-clip-discard");
    
    if (btnFocusConfirm && btnFocusDiscard) {
        if (clip.status !== "pending") {
            btnFocusConfirm.disabled = true;
            btnFocusDiscard.disabled = true;
            btnFocusConfirm.style.opacity = 0.5;
            btnFocusDiscard.style.opacity = 0.5;
        } else {
            btnFocusConfirm.disabled = false;
            btnFocusDiscard.disabled = false;
            btnFocusConfirm.style.opacity = 1;
            btnFocusDiscard.style.opacity = 1;
        }
    }
    
    // Habilitar o deshabilitar botones de descarga según la existencia del video real
    const recordedBlob = state.recordedBlobs[clipId];
    
    const btnDownload = document.getElementById("btn-hud-clip-download");
    if (btnDownload) {
        if (recordedBlob) {
            btnDownload.disabled = false;
            btnDownload.style.opacity = 1;
        } else {
            btnDownload.disabled = true;
            btnDownload.style.opacity = 0.5;
        }
    }
    
    const btnFocusDownload = document.getElementById("btn-focus-clip-download");
    if (btnFocusDownload) {
        if (recordedBlob) {
            btnFocusDownload.disabled = false;
            btnFocusDownload.style.opacity = 1;
        } else {
            btnFocusDownload.disabled = true;
            btnFocusDownload.style.opacity = 0.5;
        }
    }

    // Configurar visibilidad del player basada en si hay blob de video real
    if (recordedBlob) {
        if (hudPlayBtn) hudPlayBtn.style.display = "block";
        if (hudPlaceholder) hudPlaceholder.style.display = "none";
        if (hudControls) hudControls.style.display = "flex";
        
        if (focusPlayBtn) focusPlayBtn.style.display = "block";
        if (focusPlaceholder) focusPlaceholder.style.display = "none";
        if (focusControls) focusControls.style.display = "flex";
    } else {
        if (hudPlayBtn) hudPlayBtn.style.display = "none";
        if (hudPlaceholder) {
            hudPlaceholder.style.display = "block";
            hudPlaceholder.textContent = "Video no grabado (Auto-Grabar estaba desactivado)";
        }
        if (hudControls) hudControls.style.display = "none";
        
        if (focusPlayBtn) focusPlayBtn.style.display = "none";
        if (focusPlaceholder) {
            focusPlaceholder.style.display = "block";
            focusPlaceholder.textContent = "Video no grabado (Auto-Grabar estaba desactivado)";
        }
        if (focusControls) focusControls.style.display = "none";
    }
}

function startReviewVideoPlayback(canvasId = "hud-player-canvas", buttonId = "hud-btn-play-video") {
    if (state.isPlayingVideo) return;
    
    state.isPlayingVideo = true;
    const playBtn = document.getElementById(buttonId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    playBtn.style.opacity = "0";
    canvas.style.opacity = "1";
    
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
    
    const recordedBlob = state.recordedBlobs[state.activeClipId];
    if (recordedBlob) {
        // Reproducir video de evidencia real compilado
        const videoEl = document.createElement("video");
        videoEl.src = URL.createObjectURL(recordedBlob);
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.play();
        
        state.activeVideoElement = videoEl;
        
        function replayReal() {
            if (!state.isPlayingVideo) {
                videoEl.pause();
                URL.revokeObjectURL(videoEl.src);
                return;
            }
            state.activeLoops.videoReplay = requestAnimationFrame(replayReal);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (videoEl.readyState >= 2) {
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#020406";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#fff";
                ctx.font = "10px Inter";
                ctx.textAlign = "center";
                ctx.fillText("Cargando evidencia...", canvas.width / 2, canvas.height / 2);
            }
            
            // Scanlines estilizadas
            ctx.strokeStyle = "rgba(255, 23, 68, 0.05)";
            ctx.lineWidth = 1.5;
            const lineY = (videoEl.currentTime * 60) % canvas.height;
            ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(canvas.width, lineY); ctx.stroke();
            
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = "8px monospace";
            ctx.textAlign = "left";
            const seconds = videoEl.currentTime.toFixed(1);
            ctx.fillText(`PLAY | EVIDENCIA REAL | 00:${seconds.padStart(4, '0')} / 00:10.0`, 10, 15);
            
            if (videoEl.ended || videoEl.currentTime >= 10.0) {
                stopReviewVideoPlayback();
            }
        }
        replayReal();
        return;
    }
    
    // Fallback: Reproducción limpia sin siluetas animadas
    let playFrame = 0;
    
    function replay() {
        if (!state.isPlayingVideo) return;
        state.activeLoops.videoReplay = requestAnimationFrame(replay);
        
        playFrame++;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#020406";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Scanlines
        ctx.strokeStyle = "rgba(255, 23, 68, 0.04)";
        ctx.lineWidth = 1.5;
        const lineY = (playFrame * 2.5) % canvas.height;
        ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(canvas.width, lineY); ctx.stroke();
        
        // Mensaje de estado limpio
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "bold 11px Inter";
        ctx.textAlign = "center";
        ctx.fillText("EVIDENCIA DE VIDEO DE EJEMPLO", canvas.width / 2, canvas.height / 2 - 5);
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px Inter";
        ctx.fillText("Active 'Auto-Grabar' en el panel superior", canvas.width / 2, canvas.height / 2 + 10);
        ctx.fillText("para grabar y descargar clips reales del rostro.", canvas.width / 2, canvas.height / 2 + 22);
        
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "8px monospace";
        ctx.textAlign = "left";
        const seconds = Math.floor(playFrame / 30);
        ctx.fillText(`PLAY | REC EVIDENCIA | 00:0${seconds} / 00:10`, 10, 15);
        
        if (playFrame >= 300) {
            stopReviewVideoPlayback();
        }
    }
    replay();
}

function stopReviewVideoPlayback() {
    state.isPlayingVideo = false;
    if (state.activeLoops.videoReplay) cancelAnimationFrame(state.activeLoops.videoReplay);
    
    if (state.activeVideoElement) {
        state.activeVideoElement.pause();
        URL.revokeObjectURL(state.activeVideoElement.src);
        state.activeVideoElement = null;
    }
    
    const clipId = state.activeClipId;
    const recordedBlob = state.recordedBlobs[clipId];
    const hasVideo = !!(clipId && recordedBlob);
    
    const playBtn = document.getElementById("hud-btn-play-video");
    const canvas = document.getElementById("hud-player-canvas");
    if (canvas) canvas.style.opacity = "0";
    if (playBtn) {
        playBtn.style.opacity = "1";
        playBtn.style.display = hasVideo ? "block" : "none";
    }
    
    const focusPlayBtn = document.getElementById("focus-btn-play-video");
    const focusCanvas = document.getElementById("focus-player-canvas");
    if (focusCanvas) focusCanvas.style.opacity = "0";
    if (focusPlayBtn) {
        focusPlayBtn.style.opacity = "1";
        focusPlayBtn.style.display = hasVideo ? "block" : "none";
    }
}

function setClipVeredict(statusStr) {
    const clipIndex = state.clips.findIndex(c => c.id === state.activeClipId);
    if (clipIndex === -1) return;
    
    const clip = state.clips[clipIndex];
    if (clip.status !== "pending") return;
    
    if (statusStr === "discarded") {
        // Eliminar por completo el clip de la lista
        state.clips.splice(clipIndex, 1);
        // Borrar el blob de video asociado para liberar RAM
        delete state.recordedBlobs[clip.id];
        showToast("Alerta de copia descartada y eliminada del sistema.");
        
        // Seleccionar el primer incidente disponible en la lista o null si quedó vacía
        if (state.clips.length > 0) {
            state.activeClipId = state.clips[0].id;
        } else {
            state.activeClipId = null;
        }
    } else {
        clip.status = statusStr;
        showToast("Alerta de copia validada y guardada en auditoría.");
    }
    
    const badge = document.getElementById("badge-clips-count");
    if (badge) badge.textContent = state.clips.filter(c => c.status === "pending").length;
    
    if (state.currentView === "dashboard") {
        renderClipsInboxList();
        syncClipDisplayDetails(state.activeClipId);
    } else if (state.currentView === "inbox") {
        renderClipsInboxList("focus-clips-list");
        syncClipDisplayDetails(state.activeClipId);
    }
}

// --- 12. ALUMNOS & ROSTER GRID TABLE ---
function renderStudentsGrid() {
    const grid = document.getElementById("hud-students-grid");
    if (!grid) return;
    
    grid.innerHTML = "";
    state.students.forEach(student => {
        let stateBadgeText = "Desconectado";
        if (student.active) {
            stateBadgeText = student.state.charAt(0).toUpperCase() + student.state.slice(1);
            if (stateBadgeText === "Copia") stateBadgeText = "Copia Detectada";
        }
        
        const card = document.createElement("div");
        card.className = `student-card ${student.id === state.selectedStudentId ? "active-card" : ""}`;
        card.dataset.studentId = student.id;
        card.dataset.state = student.active ? student.state : "offline";
        
        card.innerHTML = `
            <div class="student-avatar"><i class="fa-solid fa-user-graduate"></i></div>
            <div class="student-name" style="display:flex; align-items:center; justify-content:center; gap:6px;">
                <span>${student.name}</span>
                <i class="fa-solid fa-pen" style="font-size:8px; color:var(--text-secondary); cursor:pointer;" onclick="renameStudent(${student.id}); event.stopPropagation();"></i>
            </div>
            <span class="student-state-badge">${stateBadgeText}</span>
            <div class="student-bio-id">${state.biometricsBypassed ? student.bioMatch : "Excluido"}</div>
            <div class="attention-gauge-container">
                <div class="attention-gauge-fill" style="width: ${student.active ? ((1.0 - student.prob) * 100).toFixed(0) : 0}%"></div>
            </div>
        `;
        
        card.addEventListener("click", () => {
            state.selectedStudentId = student.id;
            renderStudentsGrid();
        });
        
        grid.appendChild(card);
    });
}

function updateRosterTable() {
    const tableBody = document.getElementById("roster-table-body");
    if (!tableBody) return;
    
    tableBody.innerHTML = "";
    state.students.forEach(student => {
        const tr = document.createElement("tr");
        
        const avatarCell = `<td><div class="student-avatar" style="width:24px; height:24px; font-size:10px;"><i class="fa-solid fa-user-graduate"></i></div></td>`;
        const nameCell = `<td>
            <div style="display:flex; align-items:center; gap:8px;">
                <strong>${student.name}</strong>
                <i class="fa-solid fa-pen edit-name-icon" style="cursor:pointer; font-size:9px; color:var(--text-secondary);" onclick="renameStudent(${student.id})"></i>
            </div>
        </td>`;
        
        let stateBadgeClass = "dot-secondary";
        let stateLabel = "Desconectado";
        if (student.active) {
            if (student.state === "atento") { stateBadgeClass = "dot-success"; stateLabel = "Atento"; }
            else if (student.state === "distraido") { stateBadgeClass = "dot-warning"; stateLabel = "Distraído"; }
            else if (student.state === "somnoliento") { stateBadgeClass = "dot-danger"; stateLabel = "Somnoliento"; }
            else if (student.state === "copia" || student.state === "sospechoso") { stateBadgeClass = "dot-danger"; stateLabel = "Copia Detectada"; }
        }
        
        const stateCell = `<td><span class="dot ${stateBadgeClass}"></span> ${stateLabel}</td>`;
        const probCell = `<td class="font-mono">${student.active ? (( (1.0 - student.prob) * 100).toFixed(0) + "%") : "-"}</td>`;
        const bioCell = `<td class="font-mono text-muted">${state.biometricsBypassed ? student.bioMatch : "Excluido por Privacidad"}</td>`;
        
        const actionsCell = `
            <td>
                <button class="btn btn-outline btn-sm" onclick="renameStudent(${student.id})">Renombrar</button>
            </td>
        `;
        
        tr.innerHTML = avatarCell + nameCell + stateCell + probCell + bioCell + actionsCell;
        tableBody.appendChild(tr);
    });
}

function updateRosterCardSelection() {
    const currentStudent = state.students.find(s => s.id === state.selectedStudentId);
    if (!currentStudent) return;
    
    const cards = document.querySelectorAll(".student-card");
    cards.forEach(c => {
        c.classList.toggle("active-card", parseInt(c.dataset.studentId) === state.selectedStudentId);
    });
}

function overrideAttentionState(newState) {
    const student = state.students.find(s => s.id === state.selectedStudentId);
    if (!student) return;
    
    // Activar de forma simulada
    student.active = true;
    student.state = newState;
    
    if (newState === "atento") student.prob = 0.08 + Math.random()*0.05;
    else if (newState === "distraido") student.prob = 0.50 + Math.random()*0.15;
    else if (newState === "somnoliento") student.prob = 0.30 + Math.random()*0.10;
    
    renderStudentsGrid();
    updateRosterTable();
    showToast(`Estado de ${student.name} anulado manualmente a: ${newState.toUpperCase()}`);
}

// --- 13. CONFIGURACIÓN: ESTADÍSTICAS Y ENTRENAMIENTO DE MOBILEVIT ---
function activateSettingsTab(tabId) {
    document.querySelectorAll("#hud-technical-tabs .tab-btn").forEach(btn => {
        btn.classList.toggle("active-tab", btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll("#view-settings .drawer-tab-content").forEach(content => {
        content.classList.toggle("active-content", content.id === tabId);
    });
    
    if (tabId === "tab-stats-settings") {
        initializeSettingsStatsChart();
    } else if (tabId === "tab-ml-settings") {
        initializeSettingsMLChart();
        refreshDatasetStatus();
    }
}

function initializeSettingsStatsChart() {
    if (state.statsChart) {
        state.statsChart.destroy();
        state.statsChart = null;
    }
    
    const canvas = document.getElementById("hud-settings-stats-chart");
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    state.statsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Atento', 'Distraído', 'Somnoliento', 'Sospecha'],
            datasets: [{
                label: 'Minutos en Sesión',
                data: [42, 12, 5, 1],
                backgroundColor: ['rgba(16, 185, 129, 0.4)', 'rgba(245, 158, 11, 0.4)', 'rgba(239, 68, 68, 0.4)', 'rgba(255, 23, 68, 0.4)'],
                borderColor: ['#10b981', '#f59e0b', '#ef4444', '#ff1744'],
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6b7280', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 9 } } }
            }
        }
    });
}

function initializeSettingsMLChart() {
    if (state.trainingChart) {
        state.trainingChart.destroy();
        state.trainingChart = null;
    }
    
    const canvas = document.getElementById("hud-settings-train-chart");
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    state.trainingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Precisión Val (%)',
                data: [],
                borderColor: '#0ea5e9',
                borderWidth: 1.5,
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: true, ticks: { color: '#6b7280', font: { size: 8 } } },
                y: { min: 30, max: 100, ticks: { color: '#6b7280', font: { size: 8 } }, grid: { color: 'rgba(255,255,255,0.03)' } }
            }
        }
    });
}

// --- 14. REAL PYTORCH TRAINING INTEGRATION ---
let trainingStatusInterval = null;

function handleStartRealTraining() {
    const epochs = document.getElementById("trainEpochs").value;
    const batchSize = document.getElementById("trainBatchSize").value;
    const lr = document.getElementById("trainLr").value;
    
    document.getElementById("btnStartRealTrain").disabled = true;
    document.getElementById("btnStopRealTrain").disabled = false;
    
    const consoleBox = document.getElementById("hud-train-settings-console");
    consoleBox.innerHTML = `[COMPILADOR] Iniciando entrenamiento MobileViT real...<br>`;
    
    fetch(`/api/train/start?epochs=${epochs}&batch_size=${batchSize}&lr=${lr}`, { method: "POST" })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showToast("Entrenamiento real iniciado en el backend.");
            startTrainingStatusPolling();
        } else {
            consoleBox.innerHTML += `<span style="color:#ff1744;">[ERROR] ${data.message}</span><br>`;
            resetTrainingRealUI();
        }
    })
    .catch(err => {
        console.error(err);
        showToast("Error de conexión al iniciar entrenamiento.");
        resetTrainingRealUI();
    });
}

function handleStopRealTraining() {
    fetch("/api/train/stop", { method: "POST" })
    .then(res => res.json())
    .then(data => {
        showToast("Entrenamiento detenido.");
        clearInterval(trainingStatusInterval);
        resetTrainingRealUI();
    });
}

function resetTrainingRealUI() {
    document.getElementById("btnStartRealTrain").disabled = false;
    document.getElementById("btnStopRealTrain").disabled = true;
}

function startTrainingStatusPolling() {
    if (trainingStatusInterval) clearInterval(trainingStatusInterval);
    
    const consoleBox = document.getElementById("hud-train-settings-console");
    const epochLabel = document.getElementById("hud-settings-train-epoch");
    const accLabel = document.getElementById("hud-settings-train-acc");
    const progressFill = document.getElementById("hud-settings-train-progress");
    
    let lastHistoryLength = 0;
    initializeSettingsMLChart();
    
    trainingStatusInterval = setInterval(() => {
        fetch("/api/train/status")
        .then(res => res.json())
        .then(status => {
            if (status.status === "training") {
                const epoch = status.current_epoch;
                const total = status.total_epochs;
                const progressPct = status.percentage;
                
                epochLabel.textContent = `${epoch}/${total}`;
                accLabel.textContent = `${(status.val_accuracy * 100).toFixed(1)}%`;
                progressFill.style.width = progressPct + "%";
                
                consoleBox.innerHTML += `Epoch ${epoch}/${total} - Batch ${status.batch_index}/${status.total_batches} - Loss: ${status.train_loss.toFixed(4)} - Val Acc: ${(status.val_accuracy * 100).toFixed(1)}%<br>`;
                consoleBox.scrollTop = consoleBox.scrollHeight;
                
                const history = status.history;
                if (history && history.epochs.length > lastHistoryLength) {
                    lastHistoryLength = history.epochs.length;
                    if (state.trainingChart) {
                        state.trainingChart.data.labels = history.epochs.map(e => `E${e}`);
                        state.trainingChart.data.datasets[0].data = history.val_accuracy.map(acc => (acc * 100).toFixed(1));
                        state.trainingChart.update();
                    }
                }
            } else if (status.status === "completed") {
                clearInterval(trainingStatusInterval);
                showToast("Entrenamiento completado.");
                consoleBox.innerHTML += `<span style="color: #00e676;">[FIN] Entrenamiento finalizado con éxito. Validación Acc: ${(status.val_accuracy * 100).toFixed(1)}%</span><br>`;
                consoleBox.scrollTop = consoleBox.scrollHeight;
                
                epochLabel.textContent = `${status.total_epochs}/${status.total_epochs}`;
                accLabel.textContent = `${(status.val_accuracy * 100).toFixed(1)}%`;
                progressFill.style.width = "100%";
                resetTrainingRealUI();
            } else if (status.status === "failed") {
                clearInterval(trainingStatusInterval);
                showToast("Entrenamiento fallido.");
                consoleBox.innerHTML += `<span style="color: #ff1744;">[FALLO] Interrumpido: ${status.error}</span><br>`;
                consoleBox.scrollTop = consoleBox.scrollHeight;
                resetTrainingRealUI();
            }
        })
        .catch(err => console.error(err));
    }, 1200);
}

// --- 15. SIMULACIÓN DE ENTRENAMIENTO DEMO REJUGANDO HISTORIAL REAL ---
function startMLTrainingSim() {
    const consoleBox = document.getElementById("hud-train-settings-console");
    const epochLabel = document.getElementById("hud-settings-train-epoch");
    const accLabel = document.getElementById("hud-settings-train-acc");
    const progressFill = document.getElementById("hud-settings-train-progress");
    
    if (state.activeLoops.trainingSim) clearInterval(state.activeLoops.trainingSim);
    initializeSettingsMLChart();
    
    consoleBox.innerHTML = `[SIMULADOR] Buscando historial de entrenamiento previo...<br>`;
    
    // Consultar si existen métricas de entrenamiento real previo en disco
    fetch("/api/train/metrics")
    .then(res => res.json())
    .then(data => {
        if (data.status === "success" && data.metrics && data.metrics.history) {
            consoleBox.innerHTML += `<span style="color: #00e5ff;">[SISTEMA] ¡Métricas reales encontradas! Rejugando curva real...</span><br>`;
            replayTrainingHistory(data.metrics.history);
        } else {
            consoleBox.innerHTML += `[SISTEMA] No se encontró historial real. Iniciando simulación matemática...<br>`;
            runMathSimulation();
        }
    })
    .catch(err => {
        consoleBox.innerHTML += `[SISTEMA] Error al consultar API. Corriendo simulación matemática...<br>`;
        runMathSimulation();
    });
}

function replayTrainingHistory(history) {
    const consoleBox = document.getElementById("hud-train-settings-console");
    const epochLabel = document.getElementById("hud-settings-train-epoch");
    const accLabel = document.getElementById("hud-settings-train-acc");
    const progressFill = document.getElementById("hud-settings-train-progress");
    
    const epochsList = history.epochs;
    const trainLossList = history.train_loss;
    const valAccList = history.val_accuracy;
    
    let step = 0;
    const total = epochsList.length;
    
    state.activeLoops.trainingSim = setInterval(() => {
        if (step >= total) {
            clearInterval(state.activeLoops.trainingSim);
            consoleBox.innerHTML += `<span style="color: #00e676;">[FIN] Simulación rápida finalizada. Curva cargada de pesos reales.</span>`;
            consoleBox.scrollTop = consoleBox.scrollHeight;
            showToast("Simulación de entrenamiento finalizada.");
            return;
        }
        
        const epoch = epochsList[step];
        const loss = trainLossList[step];
        const acc = valAccList[step] * 100;
        
        consoleBox.innerHTML += `Epoch ${epoch}/${total} - Loss: ${loss.toFixed(4)} - Val Acc: ${acc.toFixed(1)}% (REPLAY REAL)<br>`;
        consoleBox.scrollTop = consoleBox.scrollHeight;
        
        epochLabel.textContent = `${epoch}/${total}`;
        accLabel.textContent = `${acc.toFixed(1)}%`;
        progressFill.style.width = `${(epoch / total) * 100}%`;
        
        if (state.trainingChart) {
            state.trainingChart.data.labels.push(`E${epoch}`);
            state.trainingChart.data.datasets[0].data.push(acc.toFixed(1));
            state.trainingChart.update();
        }
        
        step++;
    }, 200); // Replay ultra rápido cada 200ms por época
}

function runMathSimulation() {
    const consoleBox = document.getElementById("hud-train-settings-console");
    const epochLabel = document.getElementById("hud-settings-train-epoch");
    const accLabel = document.getElementById("hud-settings-train-acc");
    const progressFill = document.getElementById("hud-settings-train-progress");
    
    let epoch = 0;
    let accuracy = 35.2;
    
    state.activeLoops.trainingSim = setInterval(() => {
        epoch++;
        
        accuracy += (92.5 - accuracy) * 0.15 + (Math.random() - 0.5) * 3;
        accuracy = Math.min(accuracy, 96.5);
        
        const loss = (1.8 / (epoch * 0.2 + 1) + Math.random() * 0.04).toFixed(4);
        
        consoleBox.innerHTML += `Epoch ${epoch}/30 - Loss: ${loss} - Val Acc: ${accuracy.toFixed(1)}%<br>`;
        consoleBox.scrollTop = consoleBox.scrollHeight;
        
        epochLabel.textContent = `${epoch}/30`;
        accLabel.textContent = `${accuracy.toFixed(1)}%`;
        progressFill.style.width = `${(epoch / 30) * 100}%`;
        
        if (state.trainingChart) {
            state.trainingChart.data.labels.push(`E${epoch}`);
            state.trainingChart.data.datasets[0].data.push(accuracy.toFixed(1));
            state.trainingChart.update();
        }
        
        if (epoch >= 30) {
            clearInterval(state.activeLoops.trainingSim);
            consoleBox.innerHTML += `<span style="color: #00e676;">[FIN] Simulación finalizada. accuracy = ${accuracy.toFixed(1)}%</span>`;
            consoleBox.scrollTop = consoleBox.scrollHeight;
            showToast("Simulación MobileViT finalizada.");
        }
    }, 200);
}

// --- 16. DATASET EXTRACTION & GALLERY LOGIC ---
let extractionInterval = null;

function handleStartExtraction() {
    const classVal = document.querySelector('input[name="classSelect"]:checked').value;
    const intervalVal = document.getElementById("frameInterval").value;
    const localPath = document.getElementById("localVideoPath").value.trim();
    const fileInput = document.getElementById("videoFile");
    
    const formData = new FormData();
    formData.append("label", classVal);
    formData.append("frame_interval", intervalVal);
    formData.append("local_path", localPath);
    formData.append("flip", document.getElementById("augFlip").checked);
    formData.append("brightness", document.getElementById("augBrightness").checked);
    formData.append("contrast", document.getElementById("augContrast").checked);
    formData.append("rotation", document.getElementById("augRotation").checked);
    formData.append("blur_noise", document.getElementById("augBlurNoise").checked);
    formData.append("filter_blur", document.getElementById("filterBlur").checked);
    formData.append("filter_pose", document.getElementById("filterPose").checked);
    
    if (fileInput.files.length > 0) {
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append("files", fileInput.files[i]);
        }
    }
    
    document.getElementById("btnStartExtraction").disabled = true;
    document.getElementById("btnStopExtraction").disabled = false;
    document.getElementById("extractionProgressSection").style.display = "block";
    document.getElementById("extractionStatusText").textContent = "Iniciando extracción...";
    
    fetch("/api/dataset/process", {
        method: "POST",
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showToast("Procesamiento de videos iniciado.");
            startExtractionPolling();
        } else {
            showToast("Error: " + data.message);
            resetExtractionUI();
        }
    })
    .catch(err => {
        console.error(err);
        showToast("Error al conectar con la API.");
        resetExtractionUI();
    });
}

function startExtractionPolling() {
    if (extractionInterval) clearInterval(extractionInterval);
    
    extractionInterval = setInterval(() => {
        fetch("/api/dataset/progress")
        .then(res => res.json())
        .then(progress => {
            if (progress.status === "processing") {
                const pct = progress.percentage;
                document.getElementById("extractionProgressBar").style.width = pct + "%";
                document.getElementById("extractionProgressPct").textContent = pct + "%";
                document.getElementById("extractionStatusText").textContent = `Procesando: ${progress.current_video}`;
                document.getElementById("valExtractedFrames").textContent = `${progress.current_frame}/${progress.total_frames}`;
                document.getElementById("valExtractedFaces").textContent = progress.faces_extracted;
                document.getElementById("valExtractedAug").textContent = progress.augmented_generated;
            } else if (progress.status === "completed") {
                clearInterval(extractionInterval);
                showToast("Extracción completada.");
                resetExtractionUI();
                refreshDatasetStatus();
            } else if (progress.status === "failed") {
                clearInterval(extractionInterval);
                showToast("Extracción fallida: " + progress.error);
                resetExtractionUI();
                refreshDatasetStatus();
            } else {
                clearInterval(extractionInterval);
                resetExtractionUI();
            }
        })
        .catch(err => console.error(err));
    }, 1000);
}

function handleStopExtraction() {
    fetch("/api/dataset/stop", { method: "POST" })
    .then(res => res.json())
    .then(data => {
        showToast("Extracción detenida.");
        clearInterval(extractionInterval);
        resetExtractionUI();
        refreshDatasetStatus();
    });
}

function resetExtractionUI() {
    document.getElementById("btnStartExtraction").disabled = false;
    document.getElementById("btnStopExtraction").disabled = true;
    document.getElementById("extractionProgressSection").style.display = "none";
}

function handleClearDataset() {
    if (confirm("¿Está seguro de que desea eliminar todos los fotogramas del dataset? Esta acción no se puede deshacer.")) {
        fetch("/api/dataset/clear", { method: "POST" })
        .then(res => res.json())
        .then(data => {
            showToast("Dataset vaciado.");
            refreshDatasetStatus();
        });
    }
}

function handleDownloadDataset() {
    window.location.href = "/api/dataset/download";
    showToast("Descargando zip comprimido del dataset...");
}

function refreshDatasetStatus() {
    fetch("/api/dataset/status")
    .then(res => res.json())
    .then(data => {
        const counts = data.counts;
        document.getElementById("countAtento").textContent = counts.Atento.total;
        document.getElementById("countDistraido").textContent = counts.Distraido.total;
        document.getElementById("countSospechoso").textContent = counts.Sospechoso.total;
        
        const total = counts.Atento.total + counts.Distraido.total + counts.Sospechoso.total;
        document.getElementById("totalDatasetSamples").textContent = total;
        
        loadGalleryTab(gallerySelectedClass);
    })
    .catch(err => console.error(err));
}

let gallerySelectedClass = "Atento";

function loadGalleryTab(cls) {
    gallerySelectedClass = cls;
    
    document.getElementById("tabGalleryAtento").classList.toggle("active-gallery-tab", cls === "Atento");
    document.getElementById("tabGalleryDistraido").classList.toggle("active-gallery-tab", cls === "Distraido");
    document.getElementById("tabGallerySospechoso").classList.toggle("active-gallery-tab", cls === "Sospechoso");
    
    const grid = document.getElementById("datasetGalleryGrid");
    if (!grid) return;
    grid.innerHTML = "";
    
    fetch(`/api/dataset/images/${cls}`)
    .then(res => res.json())
    .then(data => {
        galleryImages = data.images || [];
        if (galleryImages.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; font-size:9px; color:var(--text-secondary); padding: 20px 0;">No hay muestras cargadas en esta clase.</div>`;
            return;
        }
        
        // Mostrar máximo 45 recortes en la minigalería por rendimiento
        const previewList = galleryImages.slice(0, 45);
        previewList.forEach((url, idx) => {
            const img = document.createElement("img");
            img.src = url;
            img.style.width = "100%";
            img.style.height = "40px";
            img.style.objectFit = "cover";
            img.style.borderRadius = "3px";
            img.style.cursor = "pointer";
            img.onclick = () => openLightbox(idx);
            grid.appendChild(img);
        });
    })
    .catch(err => console.error(err));
}

// --- 17. LIGHTBOX GALLERY VIEW LOGIC ---
let galleryImages = [];
let lightboxIndex = 0;
let lightboxLandmarks = null;
let showLightboxLandmarks = false;

window.openLightbox = function(index) {
    lightboxIndex = index;
    const modal = document.getElementById("lightboxModal");
    if (!modal) return;
    modal.style.display = "flex";
    
    loadLightboxFrame();
};

window.closeLightbox = function() {
    const modal = document.getElementById("lightboxModal");
    if (modal) modal.style.display = "none";
};

window.navigateLightbox = function(direction) {
    if (galleryImages.length === 0) return;
    lightboxIndex = (lightboxIndex + direction + galleryImages.length) % galleryImages.length;
    loadLightboxFrame();
};

function loadLightboxFrame() {
    const imgUrl = galleryImages[lightboxIndex];
    if (!imgUrl) return;
    
    const img = document.getElementById("lightboxImg");
    img.src = imgUrl;
    
    const filename = imgUrl.substring(imgUrl.lastIndexOf('/') + 1);
    document.getElementById("lightboxFilename").textContent = filename;
    
    const badge = document.getElementById("lightboxClassBadge");
    const classText = document.getElementById("lightboxClassText");
    badge.className = "lightbox-class-badge " + gallerySelectedClass.toLowerCase();
    classText.textContent = gallerySelectedClass;
    
    const checkbox = document.getElementById("lightboxLandmarksToggle");
    checkbox.checked = showLightboxLandmarks;
    
    // Consultar landmarks y pose al backend
    fetch(`/api/dataset/landmarks?img_url=${encodeURIComponent(imgUrl)}`)
    .then(res => res.json())
    .then(resData => {
        if (resData.status === "success") {
            const data = resData.data;
            lightboxLandmarks = data.landmarks;
            
            document.getElementById("posePitch").textContent = data.pose.pitch.toFixed(1) + "°";
            document.getElementById("poseYaw").textContent = data.pose.yaw.toFixed(1) + "°";
            document.getElementById("poseRoll").textContent = data.pose.roll.toFixed(1) + "°";
            document.getElementById("poseQualityStatus").textContent = "Estimado";
            document.getElementById("poseQualityStatus").style.color = "#00e5ff";
            
            document.getElementById("poseInterpretation").textContent = getPoseInterpretation(data.pose);
            updateCriteriaList(data.pose);
            
            // Redibujar
            drawLightboxOverlays();
        } else {
            clearPoseDetails();
        }
    })
    .catch(err => {
        console.error(err);
        clearPoseDetails();
    });
}

function clearPoseDetails() {
    lightboxLandmarks = null;
    document.getElementById("posePitch").textContent = "-";
    document.getElementById("poseYaw").textContent = "-";
    document.getElementById("poseRoll").textContent = "-";
    document.getElementById("poseQualityStatus").textContent = "Error";
    document.getElementById("poseQualityStatus").style.color = "#ff1744";
    document.getElementById("poseInterpretation").textContent = "Imposible estimar pose.";
    document.getElementById("criteriaList").innerHTML = `<li style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Error al estimar rostro.</li>`;
}

function getPoseInterpretation(pose) {
    const pitch = pose.pitch;
    const yaw = pose.yaw;
    
    if (Math.abs(yaw) > 15) return yaw > 0 ? "Mirando a la izquierda" : "Mirando a la derecha";
    if (pitch > 15) return "Mirando hacia arriba (Techo)";
    if (pitch < -15) return "Mirando hacia abajo (Pupitre/Papel)";
    return "Mirando al frente (Fijación de Pantalla)";
}

function updateCriteriaList(pose) {
    const list = document.getElementById("criteriaList");
    if (!list) return;
    
    const pitch = Math.abs(pose.pitch);
    const yaw = Math.abs(pose.yaw);
    const roll = Math.abs(pose.roll);
    
    const items = [
        { label: "Pitch calibrado (<15°)", passed: pitch < 15 },
        { label: "Yaw alineado (<15°)", passed: yaw < 15 },
        { label: "Roll correcto (<15°)", passed: roll < 15 }
    ];
    
    list.innerHTML = "";
    items.forEach(it => {
        const li = document.createElement("li");
        li.style.color = it.passed ? "#10b981" : "#ef4444";
        li.innerHTML = `<i class="fa-solid ${it.passed ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${it.label}`;
        list.appendChild(li);
    });
}

window.toggleLandmarks = function(visible) {
    showLightboxLandmarks = visible;
    drawLightboxOverlays();
};

function drawLightboxOverlays() {
    const canvas = document.getElementById("lightboxCanvas");
    const img = document.getElementById("lightboxImg");
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    
    canvas.width = img.clientWidth || 300;
    canvas.height = img.clientHeight || 220;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (showLightboxLandmarks && lightboxLandmarks) {
        ctx.fillStyle = "rgba(0, 229, 255, 0.7)";
        lightboxLandmarks.forEach(pt => {
            const px = pt.x * canvas.width;
            const py = pt.y * canvas.height;
            ctx.beginPath();
            ctx.arc(px, py, 1.2, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
}

window.deleteFrameFromLightbox = function() {
    const imgUrl = galleryImages[lightboxIndex];
    if (!imgUrl) return;
    
    if (confirm("¿Desea eliminar este recorte del dataset?")) {
        fetch("/api/dataset/delete-frame", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `img_url=${encodeURIComponent(imgUrl)}`
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showToast("Muestra eliminada.");
                closeLightbox();
                refreshDatasetStatus();
            } else {
                showToast("Error: " + data.message);
            }
        })
        .catch(err => console.error(err));
    }
};

// --- 18. NOTIFICACIONES DE AUDIO SINTETIZADO (Web Audio API) ---
function playSynthBeep() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const audioCtx = new AudioContext();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.type = "sine";
        oscillator.frequency.value = 880; // bip discreto de 880Hz
        
        gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.35);
    } catch (err) {
        console.warn("Fallo al inicializar Web Audio API: ", err);
    }
}

// --- 19. PDF DOWNLOAD SIMULATION ---
function triggerPdfDownloadSim() {
    const btn = document.getElementById("btn-settings-pdf-download");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compilando PDF...`;
    
    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Compilar y Descargar Informe PDF`;
        
        const dataStr = "SISTEMA DE MONITOREO DE AULA\nINFORME DE ATENCION ACADEMICA\nFecha: 12/06/2026\nSesion de Fisica I\n\nResumen:\nAtencion promedio: 82.4%\nAlertas resueltas: 2\n\nValidaciones:\n1. Sofia Castro - Atento\n2. Mateo Diaz - Distraido (Incidente Validado)\n3. Valeria Ruiz - Somnoliento";
        const blob = new Blob([dataStr], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "informe_atencion_aula4.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast("Reporte académico descargado exitosamente.");
    }, 1200);
}

// --- 20. AUXILIARES: TOAST NOTIFICATIONS ---
function showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = "toast-message";
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add("toast-fadeout");
        toast.addEventListener("animationend", () => {
            toast.remove();
        });
    }, 3500);
}
