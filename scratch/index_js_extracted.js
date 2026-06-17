    <script>
        // Global State Variables
        let currentTabClass = 'Atento';
        let progressInterval = null;
        let isProcessing = false;

        const behaviorDescriptions = {
            'Atento': 'Mirada fija al frente (pantalla o cámara), cabeza recta o inclinación muy leve (máx 15°). Expresión neutra y micro-movimientos normales.',
            'Distraido': 'Mirada perdida en el entorno (ventana, techo) por más de 3 segundos, inclinación fija hacia abajo (sueño), o cabeza apoyada lateralmente en la mano.',
            'Sospechoso': 'Giro rápido e intermitente de cabeza (30°-45° copia lateral), mirada hacia el regazo (celular oculto, >30°), o giro de cuello hacia atrás.'
        };

        function updateBehaviorGuide(label) {
            const titleEl = document.getElementById('behaviorGuideTitle');
            const textEl = document.getElementById('behaviorGuideText');
            
            let displayLabel = 'Atento';
            if (label === 'Distraido') displayLabel = 'Distraído';
            if (label === 'Sospechoso') displayLabel = 'Sospechoso';
            
            titleEl.innerText = displayLabel;
            textEl.innerText = behaviorDescriptions[label] || '';
        }

        // On Page Load
        window.addEventListener('DOMContentLoaded', () => {
            fetchStatus();
            // Automatically select and load Atento images
            switchGalleryTab('Atento', document.getElementById('defaultTab'));
            
            // Drag and drop events
            const dropZone = document.getElementById('fileDropZone');
            
            ['dragenter', 'dragover'].forEach(eventName => {
                dropZone.addEventListener(eventName, e => {
                    e.preventDefault();
                    dropZone.classList.add('dragover');
                }, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, e => {
                    e.preventDefault();
                    dropZone.classList.remove('dragover');
                }, false);
            });

            dropZone.addEventListener('drop', e => {
                const dt = e.dataTransfer;
                const files = dt.files;
                const fileInput = document.getElementById('videoFile');
                if (files.length > 0) {
                    fileInput.files = files;
                    handleFileSelect(fileInput);
                }
            });
        });

        // Show Toast Messages
        function showToast(message, type = 'success') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            
            let icon = '<i class="fa-solid fa-circle-check"></i>';
            if (type === 'danger') icon = '<i class="fa-solid fa-circle-exclamation"></i>';
            if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
            
            toast.innerHTML = `${icon} <span>${message}</span>`;
            container.appendChild(toast);

            // Auto remove toast
            setTimeout(() => {
                toast.style.animation = 'none';
                toast.offsetHeight; // Trigger reflow
                toast.style.transition = 'opacity 0.5s, transform 0.5s';
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-20px)';
                setTimeout(() => toast.remove(), 500);
            }, 3000);
        }

        // File Selection Logic
        function handleFileSelect(input) {
            const fileInfo = document.getElementById('selectedFileInfo');
            const fileName = document.getElementById('selectedFileName');
            const dropZone = document.getElementById('fileDropZone');
            
            if (input.files.length > 0) {
                if (input.files.length === 1) {
                    fileName.innerHTML = `<i class="fa-solid fa-video"></i> ${input.files[0].name} (${(input.files[0].size / (1024*1024)).toFixed(1)} MB)`;
                } else {
                    let totalSize = 0;
                    for (let i = 0; i < input.files.length; i++) {
                        totalSize += input.files[i].size;
                    }
                    fileName.innerHTML = `<i class="fa-solid fa-photo-film"></i> ${input.files.length} videos seleccionados (${(totalSize / (1024*1024)).toFixed(1)} MB)`;
                }
                fileInfo.style.display = 'flex';
                dropZone.style.display = 'none';
                // Clear local input to avoid confusion
                document.getElementById('localVideoPath').value = '';
            }
        }

        function clearSelectedFile() {
            document.getElementById('videoFile').value = '';
            document.getElementById('selectedFileInfo').style.display = 'none';
            document.getElementById('fileDropZone').style.display = 'block';
        }

        // Fetch overall counts and recent preview
        function fetchStatus() {
            fetch('/api/dataset/status')
                .then(res => res.json())
                .then(data => {
                    updateStatsUI(data.counts);
                    updateRecentCrops(data.recent);
                    // Also reload currently viewed gallery tab to show additions
                    loadGalleryTab(currentTabClass);
                })
                .catch(err => {
                    console.error("Error loading status:", err);
                });
        }

        // Update stats widgets (Goal Trackers)
        function updateStatsUI(counts) {
            const classes = ['Atento', 'Distraido', 'Sospechoso'];
            
            classes.forEach(cls => {
                const classData = counts[cls] || { total: 0, original: 0, augmented: 0 };
                const count = classData.total;
                const original = classData.original;
                const augmented = classData.augmented;
                
                // Get elements
                const countEl = document.getElementById(`count${cls}`);
                const barEl = document.getElementById(`progress${cls}`);
                const percentLabelEl = document.getElementById(`percentLabel${cls}`);
                const badgeEl = document.getElementById(`badge${cls}`);
                const cardEl = document.getElementById(`card${cls}`);
                
                // Set text counter
                countEl.innerHTML = `${count} <span class="stat-goal-label">/ 300</span>`;
                
                // Calculate percentage (max 100%)
                const percentage = Math.min(100, Math.round((count / 300) * 100));
                barEl.style.width = `${percentage}%`;
                
                // Update percent label with detailed breakdown (original vs augmented)
                percentLabelEl.innerHTML = `${percentage}% de la meta<br><span style="font-size:0.75rem; color:var(--text-muted); font-weight:400;">(${original} orig. / ${augmented} aum.)</span>`;
                
                // Show badge & glowing effect if meta achieved
                if (count >= 300) {
                    badgeEl.style.display = 'inline-flex';
                    cardEl.style.boxShadow = `0 8px 32px 0 rgba(0, 0, 0, 0.37), 0 0 15px rgba(16, 185, 129, 0.15)`;
                } else {
                    badgeEl.style.display = 'none';
                    cardEl.style.boxShadow = `0 8px 32px 0 rgba(0, 0, 0, 0.37)`;
                }
            });
        }

        // Update mini grid of last face crops
        function updateRecentCrops(recentMap) {
            const grid = document.getElementById('recentCropsGrid');
            grid.innerHTML = '';
            
            // Combine all classes' recent images and sort them or just pick some
            let allRecents = [];
            for (let cls in recentMap) {
                recentMap[cls].forEach(imgUrl => {
                    allRecents.push({ url: imgUrl, cls: cls });
                });
            }
            
            // Render the top 8
            const displayed = allRecents.slice(0, 8);
            
            if (displayed.length === 0) {
                grid.innerHTML = '<div style="grid-column: span 4; text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem 0;">No hay capturas recientes</div>';
                return;
            }

            displayed.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'crop-item-mini';
                
                // Tooltip info on class
                let classLabel = 'Atento';
                if (item.cls === 'Distraido') classLabel = 'Distraído';
                if (item.cls === 'Sospechoso') classLabel = 'Sospechoso';

                itemDiv.title = `Clase: ${classLabel}`;
                
                itemDiv.innerHTML = `<img src="${item.url}" alt="Recorte" onclick="openLightbox('${item.url}', '${classLabel}')">`;
                grid.appendChild(itemDiv);
            });
        }

        // Tab switches inside Gallery
        function switchGalleryTab(cls, button) {
            currentTabClass = cls;
            
            const tabs = document.querySelectorAll('.gallery-tab');
            tabs.forEach(tab => tab.classList.remove('active'));
            button.classList.add('active');

            const summaryEl = document.getElementById('gallerySummary');
            const gridEl = document.getElementById('galleryGrid');
            const trainEl = document.getElementById('trainingPanelContainer');
            const demoEl = document.getElementById('demoPanelContainer');

            // If switching away from Demo, stop webcam stream
            if (cls !== 'Demo' && webcamActive) {
                toggleWebcam();
            }

            if (cls === 'Train') {
                summaryEl.style.display = 'none';
                gridEl.style.display = 'none';
                trainEl.style.display = 'flex';
                demoEl.style.display = 'none';
                fetchTrainingStatus();
                setTimeout(initLiveTrainingChart, 150);
            } else if (cls === 'Demo') {
                summaryEl.style.display = 'none';
                gridEl.style.display = 'none';
                trainEl.style.display = 'none';
                demoEl.style.display = 'flex';
            } else {
                summaryEl.style.display = 'flex';
                gridEl.style.display = 'grid';
                trainEl.style.display = 'none';
                demoEl.style.display = 'none';
                
                let displayLabel = 'Atento';
                if (cls === 'Distraido') displayLabel = 'Distraído';
                if (cls === 'Sospechoso') displayLabel = 'Sospechoso';
                document.getElementById('galleryLabel').innerText = displayLabel;
                
                loadGalleryTab(cls);
            }
        }

        let displayedCount = 60;
        let allImagesForTab = [];

        // Fetch image paths of class from server and display them
        function loadGalleryTab(cls) {
            const grid = document.getElementById('galleryGrid');
            const countEl = document.getElementById('galleryCount');
            
            // Show a simple loading state
            grid.innerHTML = '<div class="gallery-grid-empty"><span class="loader-spinner" style="width:30px; height:30px;"></span>Cargando imágenes...</div>';

            fetch(`/api/dataset/images/${cls}`)
                .then(res => res.json())
                .then(data => {
                    allImagesForTab = data.images || [];
                    countEl.innerText = allImagesForTab.length;
                    displayedCount = 60; // reset counter
                    
                    renderImagesLimit();
                })
                .catch(err => {
                    grid.innerHTML = `<div class="gallery-grid-empty" style="grid-column: 1 / -1; color: var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error al cargar galería</div>`;
                    console.error(err);
                });
        }

        // Render images with limit and pagination to avoid browser lag
        function renderImagesLimit() {
            const grid = document.getElementById('galleryGrid');
            const cls = currentTabClass;
            
            if (allImagesForTab.length === 0) {
                grid.innerHTML = `
                    <div class="gallery-grid-empty" style="grid-column: 1 / -1;">
                        <i class="fa-solid fa-folder-open"></i>
                        <p>No hay recortes de rostros en esta clase todavía.</p>
                    </div>
                `;
                return;
            }

            grid.innerHTML = '';
            
            let labelText = 'Atento';
            if (cls === 'Distraido') labelText = 'Distraído';
            if (cls === 'Sospechoso') labelText = 'Sospechoso';

            const toRender = allImagesForTab.slice(0, displayedCount);
            
            toRender.forEach(imgUrl => {
                const card = document.createElement('div');
                card.className = 'frame-card';
                card.innerHTML = `
                    <img src="${imgUrl}" alt="Muestra" loading="lazy" onclick="openLightbox('${imgUrl}', '${labelText}')">
                    <button class="frame-card-delete" onclick="event.stopPropagation(); deleteFrame('${imgUrl}', this)" title="Eliminar muestra">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                grid.appendChild(card);
            });
            
            // Add a Load More button if there are more
            if (allImagesForTab.length > displayedCount) {
                const btnContainer = document.createElement('div');
                btnContainer.style.gridColumn = '1 / -1';
                btnContainer.style.display = 'flex';
                btnContainer.style.justify = 'center';
                btnContainer.style.padding = '1.5rem 0 0.5rem 0';
                
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.className = 'btn btn-secondary';
                loadMoreBtn.style.width = '220px';
                loadMoreBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> Cargar más imágenes...';
                loadMoreBtn.onclick = () => {
                    displayedCount += 60;
                    renderImagesLimit();
                };
                btnContainer.appendChild(loadMoreBtn);
                grid.appendChild(btnContainer);
            }
        }

        // Delete a specific frame via API
        function deleteFrame(imgUrl, buttonEl) {
            if (confirm("¿Estás seguro de que deseas eliminar esta imagen del dataset?")) {
                fetch(`/api/dataset/delete-frame?img_url=${encodeURIComponent(imgUrl)}`, {
                    method: 'POST'
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        showToast(data.message, "success");
                        // Remove from local list
                        allImagesForTab = allImagesForTab.filter(url => url !== imgUrl);
                        // Refresh display counts
                        document.getElementById('galleryCount').innerText = allImagesForTab.length;
                        // Re-render
                        renderImagesLimit();
                        // Refresh stats counters without full gallery reload
                        fetchStatusCountOnly();
                    } else {
                        showToast(data.message, "danger");
                    }
                })
                .catch(err => {
                    showToast("Error al conectar con el servidor", "danger");
                    console.error(err);
                });
            }
        }

        // Helper to fetch status without reloading the gallery (avoids loops during deletion)
        function fetchStatusCountOnly() {
            fetch('/api/dataset/status')
                .then(res => res.json())
                .then(data => {
                    updateStatsUI(data.counts);
                    updateRecentCrops(data.recent);
                })
                .catch(err => console.error(err));
        }

        // Start processing video
        function startExtraction() {
            const formData = new FormData();
            
            // Determine video source
            const fileInput = document.getElementById('videoFile');
            const localPath = document.getElementById('localVideoPath').value;
            
            if (fileInput.files.length > 0) {
                for (let i = 0; i < fileInput.files.length; i++) {
                    formData.append('files', fileInput.files[i]);
                }
            } else if (localPath.trim()) {
                formData.append('local_path', localPath.trim());
            } else {
                showToast("Por favor sube un video o ingresa la ruta local", "warning");
                return;
            }

            // Target label (selected radio)
            const activeRadio = document.querySelector('input[name="videoLabel"]:checked');
            formData.append('label', activeRadio.value);

            // Frame extraction interval
            const interval = document.getElementById('frameInterval').value;
            formData.append('frame_interval', interval);

            // Augmentations
            formData.append('flip', document.getElementById('augFlip').checked);
            formData.append('brightness', document.getElementById('augBrightness').checked);
            formData.append('contrast', document.getElementById('augContrast').checked);
            formData.append('rotation', document.getElementById('augRotation').checked);
            formData.append('blur_noise', document.getElementById('augBlurNoise').checked);
            
            // Smart Filters
            formData.append('filter_blur', document.getElementById('filterBlur').checked);
            formData.append('filter_pose', document.getElementById('filterPose').checked);

            // UI Changes - Disable form buttons
            document.getElementById('startBtn').style.display = 'none';
            document.getElementById('stopBtn').style.display = 'inline-flex';
            document.getElementById('progressPanel').style.display = 'block';
            
            isProcessing = true;

            fetch('/api/dataset/process', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Procesamiento de video iniciado", "success");
                    // Start polling progress
                    startProgressPolling();
                } else {
                    showToast(data.message, "danger");
                    resetProcessingUI();
                }
            })
            .catch(err => {
                showToast("No se pudo iniciar la conexión", "danger");
                console.error(err);
                resetProcessingUI();
            });
        }

        // Start polling extraction state
        function startProgressPolling() {
            if (progressInterval) clearInterval(progressInterval);
            
            progressInterval = setInterval(() => {
                fetch('/api/dataset/progress')
                    .then(res => res.json())
                    .then(data => {
                        updateProgressUI(data);
                        
                        // Check if finished
                        if (data.status === 'completed') {
                            clearInterval(progressInterval);
                            showToast("¡Procesamiento finalizado con éxito!", "success");
                            resetProcessingUI();
                            fetchStatus();
                        } else if (data.status === 'failed') {
                            clearInterval(progressInterval);
                            showToast(`Fallo: ${data.error}`, "danger");
                            resetProcessingUI();
                            fetchStatus();
                        } else if (data.status === 'idle') {
                            clearInterval(progressInterval);
                            resetProcessingUI();
                            fetchStatus();
                        }
                    })
                    .catch(err => {
                        console.error("Error fetching progress:", err);
                    });
            }, 1000);
        }

        // Stop processing
        function stopExtraction() {
            fetch('/api/dataset/stop', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    showToast(data.message, "warning");
                    resetProcessingUI();
                    fetchStatus();
                })
                .catch(err => {
                    console.error("Error stopping extraction:", err);
                });
        }

        // Reset UI widgets back to normal
        function resetProcessingUI() {
            document.getElementById('startBtn').style.display = 'inline-flex';
            document.getElementById('stopBtn').style.display = 'none';
            document.getElementById('progressPanel').style.display = 'none';
            isProcessing = false;
            
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
        }

        // Update active progress stats overlay
        function updateProgressUI(data) {
            document.getElementById('processingPercentage').innerText = `${data.percentage}%`;
            document.getElementById('processingProgressBar').style.width = `${data.percentage}%`;
            
            // Format queue info: (2/5) video.mp4
            const queueInfo = data.queue_total > 1 ? `[${data.queue_index}/${data.queue_total}] ` : '';
            document.getElementById('progressVideoName').innerText = `${queueInfo}${data.current_video || 'Cargando...'}`;
            
            document.getElementById('progressFrameCounter').innerText = `${data.current_frame} / ${data.total_frames}`;
            document.getElementById('progressFacesCount').innerText = data.faces_extracted;
            document.getElementById('progressAugCount').innerText = data.augmented_generated;
            
            // Quality Filters Skipped Counters
            document.getElementById('progressBlurrySkipped').innerText = data.blurry_skipped || 0;
            document.getElementById('progressDuplicateSkipped').innerText = data.duplicate_skipped || 0;
            
            // Check status for loading text
            const statusText = document.getElementById('processingStatusText');
            if (data.status === 'processing') {
                statusText.innerHTML = `<span class="loader-spinner"></span>Procesando video...`;
            } else {
                statusText.innerText = `Estado: ${data.status}`;
            }

            // Real-time refresh (very helpful to see counters update live)
            if (data.faces_extracted > 0) {
                fetchStatus();
            }
        }

        // Lightbox Global State
        let currentLightboxIndex = -1;
        let currentLightboxLandmarks = null;
        let currentLightboxPose = null;
        const landmarksCached = {};

        const criteriaMap = {
            'Atento': [
                'Mirada fija y orientada directamente al frente (cámara/pantalla).',
                'Postura de cabeza centrada y recta (inclinación máxima de ±15°).',
                'Gesticulación normal (parpadeo regular, sin muecas exageradas).',
                'Micro-movimientos tolerados sin desvío de la línea de visión.'
            ],
            'Distraido': [
                'Pérdida pasiva del foco de la clase o examen por fatiga o desinterés.',
                'Mirada perdida en el entorno (ventana, techo, etc.) por > 3 segundos.',
                'Inclinación fija de cabeza hacia abajo (simulación de sueño/cansancio).',
                'Cabeza apoyada lateralmente en la mano (fatiga/desgano).'
            ],
            'Sospechoso': [
                'Giro rápido e intermitente de cabeza (30° a 45°) simulando copia lateral.',
                'Mirada orientada hacia abajo / regazo (simulando lectura de celular).',
                'Giro completo de cuello hacia atrás o posturas de búsqueda oculta.',
                'Evadir la visibilidad frontal directa mediante movimientos anormales.'
            ]
        };

        // Lightbox Functions
        function openLightbox(url, labelText) {
            const modal = document.getElementById('lightboxModal');
            modal.style.display = 'flex';
            
            currentLightboxIndex = allImagesForTab.indexOf(url);
            
            // If image is clicked from "recent crops" and not in current tab list
            if (currentLightboxIndex === -1) {
                let targetClass = 'Atento';
                if (labelText === 'Distraído' || labelText === 'Distraido') targetClass = 'Distraido';
                if (labelText === 'Sospechoso') targetClass = 'Sospechoso';
                
                const tabs = document.querySelectorAll('.gallery-tab');
                let targetButton = null;
                tabs.forEach(tab => {
                    if (tab.innerText.includes(labelText)) {
                        targetButton = tab;
                    }
                });
                
                if (targetButton) {
                    switchGalleryTab(targetClass, targetButton);
                    
                    fetch(`/api/dataset/images/${targetClass}`)
                        .then(res => res.json())
                        .then(data => {
                            allImagesForTab = data.images || [];
                            document.getElementById('galleryCount').innerText = allImagesForTab.length;
                            currentLightboxIndex = allImagesForTab.indexOf(url);
                            loadLightboxFrame(url);
                        });
                    
                    window.addEventListener('keydown', handleLightboxKeyDown);
                    return;
                }
            }
            
            loadLightboxFrame(url);
            window.addEventListener('keydown', handleLightboxKeyDown);
        }

        function loadLightboxFrame(url) {
            if (!url) return;
            
            const img = document.getElementById('lightboxImg');
            const canvas = document.getElementById('lightboxCanvas');
            const title = document.getElementById('lightboxTitle');
            const filename = document.getElementById('lightboxFilename');
            const badge = document.getElementById('lightboxClassBadge');
            
            // Clear canvas
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            img.onload = () => {
                canvas.width = img.clientWidth;
                canvas.height = img.clientHeight;
                drawLandmarks();
            };
            
            img.src = url;
            
            const parts = url.split('/');
            const cls = parts[parts.length - 2];
            
            badge.className = `lightbox-class-badge ${cls.toLowerCase()}`;
            
            let displayLabel = 'Atento';
            let badgeIcon = '<i class="fa-solid fa-eye"></i>';
            if (cls === 'Distraido') {
                displayLabel = 'Distraído';
                badgeIcon = '<i class="fa-solid fa-compass"></i>';
            }
            if (cls === 'Sospechoso') {
                displayLabel = 'Sospechoso';
                badgeIcon = '<i class="fa-solid fa-mask"></i>';
            }
            
            badge.innerHTML = `${badgeIcon} <span>${displayLabel}</span>`;
            filename.innerText = parts[parts.length - 1];
            
            updateCriteriaList(cls);
            updatePoseUI(null, "Cargando...");
            fetchLandmarksAndPose(url);
        }

        function fetchLandmarksAndPose(url) {
            currentLightboxLandmarks = null;
            currentLightboxPose = null;
            
            if (landmarksCached[url]) {
                const cached = landmarksCached[url];
                currentLightboxLandmarks = cached.landmarks;
                currentLightboxPose = cached.pose;
                updatePoseUI(currentLightboxPose, "Estimado");
                drawLandmarks();
                return;
            }
            
            fetch(`/api/dataset/landmarks?img_url=${encodeURIComponent(url)}`)
                .then(res => res.json())
                .then(res => {
                    if (res.status === 'success' && res.data) {
                        currentLightboxLandmarks = res.data.landmarks || [];
                        currentLightboxPose = res.data.pose;
                        
                        landmarksCached[url] = {
                            landmarks: currentLightboxLandmarks,
                            pose: currentLightboxPose
                        };
                        
                        updatePoseUI(currentLightboxPose, "Estimado");
                        drawLandmarks();
                    } else {
                        updatePoseUI(null, "No detectado");
                    }
                })
                .catch(err => {
                    console.error("Error fetching landmarks:", err);
                    updatePoseUI(null, "Error");
                });
        }

        function drawLandmarks() {
            const canvas = document.getElementById('lightboxCanvas');
            const img = document.getElementById('lightboxImg');
            const ctx = canvas.getContext('2d');
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (!document.getElementById('lightboxLandmarksToggle').checked) return;
            if (!currentLightboxLandmarks || currentLightboxLandmarks.length === 0) return;
            
            canvas.width = img.clientWidth;
            canvas.height = img.clientHeight;
            
            const w = canvas.width;
            const h = canvas.height;
            
            ctx.fillStyle = '#06b6d4';
            ctx.shadowBlur = 4;
            ctx.shadowColor = '#06b6d4';
            
            currentLightboxLandmarks.forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x * w, pt.y * h, 1.2, 0, 2 * Math.PI);
                ctx.fill();
            });
            
            ctx.shadowBlur = 0;
            
            // Connect major face components
            const drawConnection = (indices, color) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                indices.forEach((idx, i) => {
                    const pt = currentLightboxLandmarks[idx];
                    if (pt) {
                        if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
                        else ctx.lineTo(pt.x * w, pt.y * h);
                    }
                });
                ctx.closePath();
                ctx.stroke();
            };
            
            drawConnection([33, 160, 158, 133, 153, 144], 'rgba(6, 182, 212, 0.4)');
            drawConnection([362, 385, 387, 263, 373, 380], 'rgba(6, 182, 212, 0.4)');
            drawConnection([61, 37, 0, 267, 291, 321, 14, 81], 'rgba(236, 72, 153, 0.4)');
        }

        function toggleLandmarks(checked) {
            if (checked) {
                drawLandmarks();
            } else {
                const canvas = document.getElementById('lightboxCanvas');
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        function updateCriteriaList(cls) {
            const list = document.getElementById('criteriaList');
            const criteriaTitle = document.getElementById('criteriaTitle');
            list.innerHTML = '';
            
            let key = 'Atento';
            if (cls === 'Distraido') key = 'Distraido';
            if (cls === 'Sospechoso') key = 'Sospechoso';
            
            const displayCls = cls === 'Distraido' ? 'Distraído' : key;
            criteriaTitle.innerHTML = `<i class="fa-solid fa-circle-check"></i> Criterios de Aceptación (${displayCls})`;
            
            const items = criteriaMap[key] || [];
            items.forEach(text => {
                const li = document.createElement('li');
                li.className = 'criteria-item';
                li.innerHTML = `<i class="fa-solid fa-check"></i> <span>${text}</span>`;
                list.appendChild(li);
            });
        }

        function updatePoseUI(pose, statusText) {
            const statusBadge = document.getElementById('poseQualityStatus');
            const pitchEl = document.getElementById('posePitch');
            const yawEl = document.getElementById('poseYaw');
            const rollEl = document.getElementById('poseRoll');
            const interpretationEl = document.getElementById('poseInterpretation');
            
            statusBadge.innerText = statusText;
            
            if (statusText === "Estimado") {
                statusBadge.style.background = "rgba(16, 185, 129, 0.15)";
                statusBadge.style.color = "var(--color-success)";
                statusBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
            } else {
                statusBadge.style.background = "rgba(255, 255, 255, 0.05)";
                statusBadge.style.color = "var(--text-muted)";
                statusBadge.style.borderColor = "rgba(255, 255, 255, 0.1)";
            }
            
            if (pose) {
                pitchEl.innerText = `${pose.pitch}°`;
                yawEl.innerText = `${pose.yaw}°`;
                rollEl.innerText = `${pose.roll}°`;
                interpretationEl.innerText = getPoseInterpretation(pose);
            } else {
                pitchEl.innerText = '-';
                yawEl.innerText = '-';
                rollEl.innerText = '-';
                interpretationEl.innerText = statusText === "Cargando..." ? "Calculando ángulos faciales..." : "No se pudo estimar la postura de la cabeza";
            }
        }

        function getPoseInterpretation(pose) {
            const p = pose.pitch;
            const y = pose.yaw;
            const r = pose.roll;
            
            if (Math.abs(p) <= 15 && Math.abs(y) <= 15 && Math.abs(r) <= 15) {
                return "Orientación: Centrada y enfocada al frente (Atento)";
            }
            
            let text = "Orientación: ";
            if (p > 15) {
                text += "Mirando hacia abajo / regazo. ";
            } else if (p < -15) {
                text += "Mirando hacia arriba. ";
            }
            
            if (y > 18) {
                text += "Cabeza girada a la derecha. ";
            } else if (y < -18) {
                text += "Cabeza girada a la izquierda. ";
            }
            
            if (Math.abs(r) > 15) {
                text += "Cabeza inclinada de lado.";
            }
            
            return text.trim();
        }

        function navigateLightbox(direction) {
            if (allImagesForTab.length === 0) return;
            if (currentLightboxIndex === -1) return;
            
            currentLightboxIndex = (currentLightboxIndex + direction + allImagesForTab.length) % allImagesForTab.length;
            const nextUrl = allImagesForTab[currentLightboxIndex];
            loadLightboxFrame(nextUrl);
        }

        function handleLightboxKeyDown(event) {
            if (event.key === 'ArrowRight') {
                navigateLightbox(1);
            } else if (event.key === 'ArrowLeft') {
                navigateLightbox(-1);
            } else if (event.key === 'Escape') {
                closeLightbox();
            }
        }

        function deleteFrameFromLightbox() {
            if (currentLightboxIndex === -1 || allImagesForTab.length === 0) return;
            
            const imgUrl = allImagesForTab[currentLightboxIndex];
            
            fetch(`/api/dataset/delete-frame?img_url=${encodeURIComponent(imgUrl)}`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Imagen eliminada directamente", "success");
                    
                    allImagesForTab = allImagesForTab.filter(url => url !== imgUrl);
                    document.getElementById('galleryCount').innerText = allImagesForTab.length;
                    
                    renderImagesLimit();
                    fetchStatusCountOnly();
                    
                    if (allImagesForTab.length === 0) {
                        closeLightbox();
                    } else {
                        if (currentLightboxIndex >= allImagesForTab.length) {
                            currentLightboxIndex = 0;
                        }
                        const nextUrl = allImagesForTab[currentLightboxIndex];
                        loadLightboxFrame(nextUrl);
                    }
                } else {
                    showToast(data.message, "danger");
                }
            })
            .catch(err => {
                showToast("Error al conectar con el servidor", "danger");
                console.error(err);
            });
        }

        function closeLightbox() {
            document.getElementById('lightboxModal').style.display = 'none';
            window.removeEventListener('keydown', handleLightboxKeyDown);
        }

        // Confirm Clear Modal Functions
        function openClearConfirmModal() {
            document.getElementById('confirmModal').style.display = 'flex';
        }

        function closeClearConfirmModal() {
            document.getElementById('confirmModal').style.display = 'none';
        }

        // Clear dataset logic
        function clearDataset() {
            fetch('/api/dataset/clear', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        showToast(data.message, 'success');
                        closeClearConfirmModal();
                        fetchStatus(); // Refresh counters & galleries
                    }
                })
                .catch(err => {
                    showToast("No se pudo vaciar el dataset", "danger");
                    console.error(err);
                });
        }

        // Training JS Integration
        let trainPollingInterval = null;
        let liveTrainingChart = null;
        let isCurrentlyTrainingReal = false;
        let lastRealPlottedEpoch = 0;

        // Simulation variables
        let isSimulating = false;
        let simulationInterval = null;

        function initLiveTrainingChart() {
            const canvas = document.getElementById('live-training-chart');
            if (!canvas) return;
            
            if (liveTrainingChart) {
                liveTrainingChart.destroy();
            }
            
            const ctx = canvas.getContext('2d');
            liveTrainingChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Precisión (%)',
                            data: [],
                            borderColor: '#0ea5e9',
                            backgroundColor: 'rgba(14, 165, 233, 0.05)',
                            fill: true,
                            yAxisID: 'y-accuracy',
                            tension: 0.3,
                            borderWidth: 2,
                            pointRadius: 3,
                            pointBackgroundColor: '#0ea5e9'
                        },
                        {
                            label: 'Pérdida',
                            data: [],
                            borderColor: '#f43f5e',
                            backgroundColor: 'rgba(244, 63, 94, 0.02)',
                            fill: false,
                            borderDash: [5, 5],
                            yAxisID: 'y-loss',
                            tension: 0.3,
                            borderWidth: 2,
                            pointRadius: 3,
                            pointBackgroundColor: '#f43f5e'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#f8fafc',
                                font: { family: 'Outfit', size: 11 }
                            }
                        },
                        tooltip: {
                            backgroundColor: '#0f172a',
                            titleColor: '#f8fafc',
                            bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            titleFont: { family: 'Outfit' },
                            bodyFont: { family: 'Outfit' }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#94a3b8',
                                font: { family: 'Outfit', size: 10 }
                            }
                        },
                        'y-accuracy': {
                            type: 'linear',
                            position: 'left',
                            min: 20,
                            max: 100,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#0ea5e9',
                                font: { family: 'Outfit', size: 10 },
                                callback: function(value) { return value + '%'; }
                            },
                            title: {
                                display: true,
                                text: 'Precisión',
                                color: '#0ea5e9',
                                font: { family: 'Outfit', size: 11, weight: 'bold' }
                            }
                        },
                        'y-loss': {
                            type: 'linear',
                            position: 'right',
                            min: 0,
                            max: 2.0,
                            grid: { drawOnChartArea: false },
                            ticks: {
                                color: '#f43f5e',
                                font: { family: 'Outfit', size: 10 }
                            },
                            title: {
                                display: true,
                                text: 'Pérdida',
                                color: '#f43f5e',
                                font: { family: 'Outfit', size: 11, weight: 'bold' }
                            }
                        }
                    }
                }
            });
        }

        function appendConsoleLine(text, type = 'info') {
            const consoleOutput = document.getElementById('console-output');
            if (!consoleOutput) return;
            
            const line = document.createElement('div');
            const timestamp = new Date().toLocaleTimeString();
            
            let color = '#10b981'; // green for normal logs
            if (type === 'system') color = '#6b7280'; // gray
            if (type === 'success') color = '#0ea5e9'; // cyan/blue
            if (type === 'error') color = '#f43f5e'; // red
            if (type === 'warning') color = '#f59e0b'; // orange
            
            line.style.color = color;
            line.innerHTML = `<span style="color: #6b7280;">[${timestamp}]</span> ${text}`;
            consoleOutput.appendChild(line);
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }

        function fetchTrainingStatus() {
            if (isSimulating) return; // ignore during simulation
            
            fetch('/api/train/status')
                .then(res => res.json())
                .then(data => {
                    updateTrainingUI(data);
                    
                    if (data.status === 'training') {
                        if (!trainPollingInterval) {
                            trainPollingInterval = setInterval(fetchTrainingStatus, 1500);
                        }
                    } else {
                        if (trainPollingInterval) {
                            clearInterval(trainPollingInterval);
                            trainPollingInterval = null;
                        }
                        
                        if (data.status === 'completed') {
                            loadSavedMetrics();
                        } else {
                            fetch('/api/train/metrics')
                                .then(res => res.json())
                                .then(metricsData => {
                                    if (metricsData.status === 'success') {
                                        renderMetrics(metricsData.metrics);
                                    }
                                });
                        }
                    }
                })
                .catch(err => console.error(err));
        }

        function startModelTraining() {
            if (isSimulating) {
                showToast("Detén la simulación primero antes de iniciar un entrenamiento real.", "warning");
                return;
            }
            const epochs = document.getElementById('trainEpochs').value;
            const batchSize = document.getElementById('trainBatchSize').value;
            const lr = document.getElementById('trainLr').value;

            fetch(`/api/train/start?epochs=${epochs}&batch_size=${batchSize}&lr=${lr}`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Entrenamiento de MobileViT iniciado", "success");
                    fetchTrainingStatus();
                } else {
                    showToast(data.message, "danger");
                }
            })
            .catch(err => {
                showToast("Error al conectar con el servidor", "danger");
                console.error(err);
            });
        }

        function stopModelTraining() {
            if (isSimulating) {
                stopSimulation();
                return;
            }
            
            fetch('/api/train/stop', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    showToast(data.message, "warning");
                    fetchTrainingStatus();
                })
                .catch(err => console.error(err));
        }

        function updateTrainingUI(data) {
            const controls = document.getElementById('trainControls');
            const progressPanel = document.getElementById('trainProgressPanel');
            const metricsPanel = document.getElementById('trainMetricsPanel');
            
            const statusText = document.getElementById('trainStatusText');
            const percentageText = document.getElementById('trainPercentage');
            const progressBar = document.getElementById('trainProgressBar');
            
            const epochVal = document.getElementById('trainEpochVal');
            const batchVal = document.getElementById('trainBatchVal');
            const lossVal = document.getElementById('trainLossVal');
            const valAccVal = document.getElementById('trainValAccVal');

            if (data.status === 'training') {
                if (!isCurrentlyTrainingReal) {
                    isCurrentlyTrainingReal = true;
                    lastRealPlottedEpoch = 0;
                    initLiveTrainingChart();
                    document.getElementById('console-output').innerHTML = '';
                    appendConsoleLine("Iniciando entrenamiento real del clasificador MobileViT...", "system");
                    appendConsoleLine(`Configuración: Épocas=${data.total_epochs}, Lote=${data.total_batches > 0 ? 'activo' : 'inicializando'}, Tasa de Aprendizaje=1e-4`, "system");
                    appendConsoleLine("Esperando inicialización de los cargadores de datos...", "system");
                }
                
                controls.style.display = 'none';
                progressPanel.style.display = 'block';
                metricsPanel.style.display = 'none';
                
                statusText.innerHTML = `<span class="loader-spinner"></span>Época ${data.current_epoch}/${data.total_epochs} (Entrenando...)`;
                percentageText.innerText = `${data.percentage}%`;
                progressBar.style.width = `${data.percentage}%`;
                
                epochVal.innerText = `${data.current_epoch} / ${data.total_epochs}`;
                batchVal.innerText = `${data.batch_index} / ${data.total_batches}`;
                lossVal.innerText = data.train_loss.toFixed(4);
                valAccVal.innerText = `${(data.val_accuracy * 100).toFixed(1)}%`;

                // Log batch details
                const batchLog = `Época ${data.current_epoch}/${data.total_epochs} - Batch ${data.batch_index}/${data.total_batches} - Pérdida: ${data.train_loss.toFixed(4)}`;
                if (!window.lastConsoleBatchLog || window.lastConsoleBatchLog !== batchLog) {
                    if (data.batch_index > 0 && data.batch_index % 4 === 0) {
                        appendConsoleLine(batchLog, "info");
                        window.lastConsoleBatchLog = batchLog;
                    }
                }

                // Epoch complete validation update using robust backend history
                if (data.history && data.history.epochs) {
                    const history = data.history;
                    if (!liveTrainingChart) {
                        initLiveTrainingChart();
                    }
                    liveTrainingChart.data.labels = history.epochs.map(e => `Época ${e}`);
                    liveTrainingChart.data.datasets[0].data = history.val_accuracy.map(acc => (acc * 100).toFixed(2));
                    liveTrainingChart.data.datasets[1].data = history.train_loss.map(loss => loss.toFixed(4));
                    liveTrainingChart.update();

                    const numPlotted = history.epochs.length;
                    if (numPlotted > lastRealPlottedEpoch) {
                        for (let i = lastRealPlottedEpoch; i < numPlotted; i++) {
                            const epNum = history.epochs[i];
                            const epLoss = history.val_loss[i];
                            const epAcc = history.val_accuracy[i];
                            appendConsoleLine(`Época ${epNum}/${data.total_epochs} completada. Loss Val: ${epLoss.toFixed(4)} - Acc Val: ${(epAcc * 100).toFixed(2)}%`, "success");
                        }
                        lastRealPlottedEpoch = numPlotted;
                    }
                }
            } else if (data.status === 'completed') {
                if (isCurrentlyTrainingReal) {
                    isCurrentlyTrainingReal = false;
                    appendConsoleLine("¡Entrenamiento del modelo finalizado de forma exitosa!", "success");
                }
                controls.style.display = 'flex';
                progressPanel.style.display = 'none';
                metricsPanel.style.display = 'flex';
                if (data.metrics) {
                    renderMetrics(data.metrics);
                }
            } else if (data.status === 'failed') {
                isCurrentlyTrainingReal = false;
                controls.style.display = 'flex';
                progressPanel.style.display = 'none';
                metricsPanel.style.display = 'none';
                showToast(data.error, "danger");
                appendConsoleLine(`Error en entrenamiento: ${data.error}`, "error");
            } else {
                isCurrentlyTrainingReal = false;
                controls.style.display = 'flex';
                progressPanel.style.display = 'none';
            }
        }

        function loadSavedMetrics() {
            fetch('/api/train/metrics')
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        renderMetrics(data.metrics);
                    }
                })
                .catch(err => console.error(err));
        }

        function renderMetrics(metrics) {
            document.getElementById('trainMetricsPanel').style.display = 'flex';
            document.getElementById('metricAccuracy').innerText = `${(metrics.final_accuracy * 100).toFixed(1)}%`;
            
            let dev = metrics.device_used || "cpu";
            if (dev.includes("cuda")) {
                dev = "Tarjeta Gráfica GPU (CUDA)";
            } else {
                dev = "Procesador CPU";
            }
            document.getElementById('metricDevice').innerText = dev;
            document.getElementById('metricDevice').title = metrics.device_used;

            const tbody = document.getElementById('metricsTableBody');
            tbody.innerHTML = '';
            
            const classes = metrics.classes || ["Atento", "Distraído", "Sospechoso"];
            classes.forEach(cls => {
                const rep = metrics.classification_report[cls] || { precision: 0, recall: 0, "f1-score": 0 };
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                tr.innerHTML = `
                    <td style="padding: 0.5rem 0; font-weight: 500;">${cls}</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(rep.precision * 100).toFixed(1)}%</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(rep.recall * 100).toFixed(1)}%</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(rep['f1-score'] * 100).toFixed(1)}%</td>
                `;
                tbody.appendChild(tr);
            });

            const cm = metrics.confusion_matrix;
            if (cm) {
                for (let i = 0; i < 3; i++) {
                    for (let j = 0; j < 3; j++) {
                        const cell = document.getElementById(`cm_${i}_${j}`);
                        const val = cm[i][j];
                        cell.innerText = val;
                        
                        const rowTotal = cm[i].reduce((a, b) => a + b, 0);
                        const intensity = rowTotal > 0 ? (val / rowTotal) : 0;
                        
                        if (i === j) {
                            cell.style.background = `rgba(16, 185, 129, ${0.15 + intensity * 0.65})`;
                            cell.style.color = intensity > 0.4 ? '#ffffff' : 'var(--color-success)';
                        } else {
                            cell.style.background = val > 0 ? `rgba(239, 68, 68, ${0.05 + intensity * 0.5})` : 'rgba(255,255,255,0.02)';
                            cell.style.color = val > 0 ? '#fca5a5' : 'var(--text-muted)';
                        }
                    }
                }
            }

            if (metrics.history) {
                drawCurvesChart(metrics.history);
            }
        }

        function drawCurvesChart(history) {
            if (!liveTrainingChart) {
                initLiveTrainingChart();
            }
            if (!liveTrainingChart || !history) return;
            
            const epochs = history.epochs || [];
            const trainLoss = history.train_loss || [];
            const valAccuracy = history.val_accuracy || [];
            
            liveTrainingChart.data.labels = epochs.map(e => `Época ${e}`);
            liveTrainingChart.data.datasets[0].data = valAccuracy.map(acc => (acc * 100).toFixed(2));
            liveTrainingChart.data.datasets[1].data = trainLoss.map(loss => loss.toFixed(4));
            liveTrainingChart.update();
        }

        // Training Simulation Logic
        function startTrainingSimulation() {
            if (isSimulating) return;
            
            fetch('/api/train/status')
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'training') {
                        showToast("Hay un entrenamiento real en curso. No se puede iniciar la simulación.", "warning");
                        return;
                    }
                    runSimulation();
                })
                .catch(err => {
                    // Fallback to local simulation if server status is offline
                    runSimulation();
                });
        }

        function runSimulation() {
            isSimulating = true;
            
            document.getElementById('trainControls').style.display = 'none';
            document.getElementById('trainProgressPanel').style.display = 'block';
            document.getElementById('trainMetricsPanel').style.display = 'none';
            
            initLiveTrainingChart();
            
            const consoleOutput = document.getElementById('console-output');
            consoleOutput.innerHTML = '';
            
            appendConsoleLine("Iniciando Simulador de Entrenamiento MobileViT...", "system");
            
            // Check if there are real training metrics available on backend
            fetch('/api/train/metrics')
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success' && data.metrics && data.metrics.history && data.metrics.history.epochs.length > 0) {
                        runRealDataSimulation(data.metrics);
                    } else {
                        appendConsoleLine("No se detectó un modelo real entrenado. Iniciando simulación matemática de referencia...", "warning");
                        runMathSimulation();
                    }
                })
                .catch(err => {
                    appendConsoleLine("Error al obtener métricas reales. Iniciando simulación matemática de referencia...", "warning");
                    runMathSimulation();
                });
        }

        function runRealDataSimulation(metrics) {
            appendConsoleLine(`Historial de entrenamiento real detectado (Dispositivo: ${metrics.device_used || 'tarjeta GPU'}).`, "system");
            appendConsoleLine("Simulando curvas y métricas reales obtenidas en el entrenamiento a alta velocidad...", "system");
            
            const history = metrics.history;
            const totalEpochs = history.epochs.length;
            const totalBatches = 10;
            
            let epochIdx = 0;
            let batch = 0;
            
            function runBatchStep() {
                if (!isSimulating) return;
                
                batch++;
                if (batch > totalBatches) {
                    const epochNum = history.epochs[epochIdx];
                    const valAcc = history.val_accuracy[epochIdx];
                    const trainLoss = history.train_loss[epochIdx];
                    const valLoss = history.val_loss ? history.val_loss[epochIdx] : (trainLoss * 0.85); // fallback
                    
                    // Push to chart
                    liveTrainingChart.data.labels.push(`Época ${epochNum}`);
                    liveTrainingChart.data.datasets[0].data.push((valAcc * 100).toFixed(2));
                    liveTrainingChart.data.datasets[1].data.push(trainLoss.toFixed(4));
                    liveTrainingChart.update();
                    
                    appendConsoleLine(`Época ${epochNum}/${totalEpochs} completada. Loss Val: ${valLoss.toFixed(4)} - Acc Val: ${(valAcc * 100).toFixed(2)}%`, "success");
                    
                    document.getElementById('trainEpochVal').innerText = `${epochNum} / ${totalEpochs}`;
                    document.getElementById('trainLossVal').innerText = trainLoss.toFixed(4);
                    document.getElementById('trainValAccVal').innerText = `${(valAcc * 100).toFixed(1)}%`;
                    
                    epochIdx++;
                    batch = 1;
                    
                    if (epochIdx >= totalEpochs) {
                        endRealSimulation(metrics);
                        return;
                    }
                }
                
                const currentEpochNum = history.epochs[epochIdx];
                const baseLoss = history.train_loss[epochIdx];
                const currentBatchLoss = baseLoss * (1.0 + (Math.random() - 0.5) * 0.12);
                
                document.getElementById('trainStatusText').innerHTML = `<span class="loader-spinner"></span>Época ${currentEpochNum}/${totalEpochs} (Simulando...)`;
                document.getElementById('trainEpochVal').innerText = `${currentEpochNum} / ${totalEpochs}`;
                document.getElementById('trainBatchVal').innerText = `${batch} / ${totalBatches}`;
                document.getElementById('trainLossVal').innerText = currentBatchLoss.toFixed(4);
                
                const percent = Math.round(((epochIdx + (batch / totalBatches)) / totalEpochs) * 100);
                document.getElementById('trainPercentage').innerText = `${percent}%`;
                document.getElementById('trainProgressBar').style.width = `${percent}%`;
                
                if (batch % 3 === 0) {
                    appendConsoleLine(`Época ${currentEpochNum}/${totalEpochs} - Batch ${batch}/${totalBatches} - Loss: ${currentBatchLoss.toFixed(4)}`);
                }
                
                simulationInterval = setTimeout(runBatchStep, 80); // Fast simulation
            }
            
            runBatchStep();
        }

        function runMathSimulation() {
            appendConsoleLine("Dispositivo de hardware simulado: GPU NVIDIA GeForce GTX 1650 (CUDA 12.1)", "system");
            appendConsoleLine("Cargando dataset de rostros enmascarados desde el disco...", "system");
            
            const countAtento = parseInt(document.getElementById('countAtento').innerText) || 300;
            const countDistraido = parseInt(document.getElementById('countDistraido').innerText) || 300;
            const countSospechoso = parseInt(document.getElementById('countSospechoso').innerText) || 300;
            const totalSamples = countAtento + countDistraido + countSospechoso;
            
            setTimeout(() => {
                appendConsoleLine(`Dataset cargado: ${totalSamples} imágenes en total (Atento: ${countAtento}, Distraído: ${countDistraido}, Sospechoso: ${countSospechoso}).`, "info");
                appendConsoleLine("Inicializando arquitectura de red MobileViT (xxs backbone + Classification Head)...", "info");
                appendConsoleLine("Estableciendo optimizador AdamW con discriminación de tasas (Backbone LR: 1e-5, Head LR: 1e-4)...", "info");
                appendConsoleLine("Comenzando entrenamiento...", "success");
                
                let epoch = 0;
                const totalEpochs = 15;
                let accuracy = 22.4;
                let loss = 1.68;
                
                let batch = 0;
                const totalBatches = 12;
                
                function runBatchStep() {
                    if (!isSimulating) return;
                    
                    batch++;
                    if (batch > totalBatches) {
                        epoch++;
                        batch = 1;
                        
                        const targetAcc = 94.5;
                        accuracy += (targetAcc - accuracy) * 0.075 + (Math.random() - 0.5) * 2.2;
                        accuracy = Math.min(accuracy, 98.2);
                        
                        loss = (1.7 / (epoch * 0.15 + 1)) + (Math.random() * 0.03);
                        
                        liveTrainingChart.data.labels.push(`Época ${epoch}`);
                        liveTrainingChart.data.datasets[0].data.push(accuracy.toFixed(2));
                        liveTrainingChart.data.datasets[1].data.push(loss.toFixed(4));
                        liveTrainingChart.update();
                        
                        appendConsoleLine(`Época ${epoch}/${totalEpochs} completada. Loss Val: ${loss.toFixed(4)} - Acc Val: ${accuracy.toFixed(2)}%`, "success");
                        
                        document.getElementById('trainEpochVal').innerText = `${epoch} / ${totalEpochs}`;
                        document.getElementById('trainLossVal').innerText = loss.toFixed(4);
                        document.getElementById('trainValAccVal').innerText = `${accuracy.toFixed(1)}%`;
                        
                        if (epoch >= totalEpochs) {
                            endMathSimulation(accuracy);
                            return;
                        }
                    }
                    
                    const currentBatchLoss = loss * (1.0 + (Math.random() - 0.5) * 0.15);
                    document.getElementById('trainStatusText').innerHTML = `<span class="loader-spinner"></span>Época ${epoch + 1}/${totalEpochs} (Simulando...)`;
                    document.getElementById('trainEpochVal').innerText = `${epoch + 1} / ${totalEpochs}`;
                    document.getElementById('trainBatchVal').innerText = `${batch} / ${totalBatches}`;
                    document.getElementById('trainLossVal').innerText = currentBatchLoss.toFixed(4);
                    
                    const percent = Math.round(((epoch + (batch / totalBatches)) / totalEpochs) * 100);
                    document.getElementById('trainPercentage').innerText = `${percent}%`;
                    document.getElementById('trainProgressBar').style.width = `${percent}%`;
                    
                    if (batch % 4 === 0) {
                        appendConsoleLine(`Época ${epoch + 1}/${totalEpochs} - Batch ${batch}/${totalBatches} - Loss: ${currentBatchLoss.toFixed(4)}`);
                    }
                    
                    simulationInterval = setTimeout(runBatchStep, 150);
                }
                
                runBatchStep();
                
            }, 1200);
        }

        function stopSimulation() {
            if (simulationInterval) {
                clearTimeout(simulationInterval);
                simulationInterval = null;
            }
            isSimulating = false;
            
            document.getElementById('trainControls').style.display = 'flex';
            document.getElementById('trainProgressPanel').style.display = 'none';
            document.getElementById('trainMetricsPanel').style.display = 'none';
            
            showToast("Simulación detenida por el usuario", "warning");
            appendConsoleLine("Simulación detenida.", "error");
        }

        function endRealSimulation(metrics) {
            isSimulating = false;
            if (simulationInterval) {
                clearTimeout(simulationInterval);
                simulationInterval = null;
            }
            
            document.getElementById('trainControls').style.display = 'flex';
            document.getElementById('trainProgressPanel').style.display = 'none';
            
            showToast("Simulación con datos reales finalizada", "success");
            appendConsoleLine(`Simulación finalizada. Precisión real final: ${(metrics.final_accuracy * 100).toFixed(2)}%`, "success");
            
            renderMetrics(metrics);
        }

        function endMathSimulation(finalAcc) {
            isSimulating = false;
            if (simulationInterval) {
                clearTimeout(simulationInterval);
                simulationInterval = null;
            }
            
            document.getElementById('trainControls').style.display = 'flex';
            document.getElementById('trainProgressPanel').style.display = 'none';
            document.getElementById('trainMetricsPanel').style.display = 'flex';
            
            showToast("Simulación de entrenamiento finalizada", "success");
            appendConsoleLine(`Simulación finalizada. Precisión final: ${finalAcc.toFixed(2)}%`, "success");
            appendConsoleLine("Modelo simulado guardado en memoria caché del cliente.", "success");
            
            document.getElementById('metricAccuracy').innerText = `${finalAcc.toFixed(1)}%`;
            document.getElementById('metricDevice').innerText = "GPU Simulado (NVIDIA GTX 1650)";
            document.getElementById('metricDevice').title = "CUDA active (Simulated)";
            
            const tbody = document.getElementById('metricsTableBody');
            tbody.innerHTML = '';
            
            const classes = ["Atento", "Distraído", "Sospechoso"];
            const fAcc = finalAcc / 100;
            
            classes.forEach((cls, idx) => {
                const variation = (Math.random() - 0.5) * 0.04;
                const prec = Math.min(0.99, fAcc + variation);
                const rec = Math.min(0.99, fAcc - variation);
                const f1 = 2 * (prec * rec) / (prec + rec);
                
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                tr.innerHTML = `
                    <td style="padding: 0.5rem 0; font-weight: 500;">${cls}</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(prec * 100).toFixed(1)}%</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(rec * 100).toFixed(1)}%</td>
                    <td style="padding: 0.5rem 0; text-align: right;">${(f1 * 100).toFixed(1)}%</td>
                `;
                tbody.appendChild(tr);
            });
            
            const cm = [
                [Math.round(100 * (fAcc + 0.02)), Math.round(100 * (1 - fAcc) / 2), Math.round(100 * (1 - fAcc) / 2)],
                [Math.round(100 * (1 - fAcc) / 2), Math.round(100 * (fAcc - 0.01)), Math.round(100 * (1 - fAcc) / 2)],
                [Math.round(100 * (1 - fAcc) / 2), Math.round(100 * (1 - fAcc) / 2), Math.round(100 * (fAcc - 0.01))]
            ];
            
            for (let i = 0; i < 3; i++) {
                const sum = cm[i][0] + cm[i][1] + cm[i][2];
                const diff = 100 - sum;
                cm[i][i] += diff;
            }
            
            for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                    const cell = document.getElementById(`cm_${i}_${j}`);
                    const val = cm[i][j];
                    cell.innerText = val;
                    
                    const intensity = val / 100;
                    
                    if (i === j) {
                        cell.style.background = `rgba(16, 185, 129, ${0.15 + intensity * 0.65})`;
                        cell.style.color = intensity > 0.4 ? '#ffffff' : 'var(--color-success)';
                    } else {
                        cell.style.background = val > 0 ? `rgba(239, 68, 68, ${0.05 + intensity * 0.5})` : 'rgba(255,255,255,0.02)';
                        cell.style.color = val > 0 ? '#fca5a5' : 'var(--text-muted)';
                    }
                }
            }
        }

        // Live Demo Webcam Integration
        let webcamStream = null;
        let webcamActive = false;
        let predictionLoop = null;
        let isPredicting = false;
        let liveLandmarks = null;
        
        // Temporal Smoothing variables
        let liveSmoothingWindow = 8;
        let liveProbabilityHistory = [];
        
        function updateSmoothingValue(val) {
            liveSmoothingWindow = parseInt(val);
            const label = document.getElementById('liveSmoothingValLabel');
            if (label) {
                label.innerText = val === '1' ? '1 frame (Off)' : `${val} frames`;
            }
        }

        async function toggleWebcam() {
            const startBtn = document.getElementById('startCamBtn');
            const statusLabel = document.getElementById('camStatusLabel');
            const overlay = document.getElementById('webcamOverlayText');
            const video = document.getElementById('webcamVideo');
            const canvas = document.getElementById('webcamCanvas');
            
            if (webcamActive) {
                // STOP WEBCAM
                stopWebcamStream();
                startBtn.className = 'btn btn-primary';
                startBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Iniciar Webcam';
                statusLabel.innerText = 'Cámara apagada';
                overlay.style.display = 'flex';
                overlay.innerHTML = '<i class="fa-solid fa-camera" style="font-size: 2rem; opacity: 0.4;"></i><span>Haz clic en "Iniciar Webcam" para comenzar</span>';
                
                // Reset predictions UI
                liveProbabilityHistory = [];
                document.getElementById('livePredictionBadge').innerText = 'INACTIVO';
                document.getElementById('livePredictionBadge').style.color = 'var(--text-muted)';
                document.getElementById('livePredictionBadge').style.textShadow = 'none';
                document.getElementById('livePredictionBadge').parentNode.style.background = 'rgba(255,255,255,0.02)';
                document.getElementById('livePredictionBadge').parentNode.style.borderColor = 'rgba(255,255,255,0.05)';
                
                ['Atento', 'Distraido', 'Sospechoso'].forEach(c => {
                    const cKey = c === 'Distraido' ? 'Distraido' : c;
                    document.getElementById(`liveProb${cKey}`).innerText = '0%';
                    document.getElementById(`liveBar${cKey}`).style.width = '0%';
                });
                
                document.getElementById('livePosePitch').innerText = '-';
                document.getElementById('livePoseYaw').innerText = '-';
                document.getElementById('livePoseRoll').innerText = '-';
                
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            } else {
                // START WEBCAM
                overlay.innerHTML = '<span class="loader-spinner" style="width:30px; height:30px;"></span><span>Iniciando cámara...</span>';
                
                try {
                    webcamStream = await navigator.mediaDevices.getUserMedia({
                        video: { width: 640, height: 480, facingMode: 'user' },
                        audio: false
                    });
                    
                    video.srcObject = webcamStream;
                    webcamActive = true;
                    startBtn.className = 'btn btn-danger';
                    startBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Apagar Webcam';
                    statusLabel.innerText = 'Streaming en vivo';
                    overlay.style.display = 'none';
                    
                    // Start classification loop
                    isPredicting = true;
                    predictionLoop = setInterval(runWebcamFrameInference, 200); // 5 inferences per second
                    requestAnimationFrame(drawWebcamStream);
                } catch (err) {
                    console.error("Error accessing webcam:", err);
                    showToast("No se pudo acceder a la cámara. Revisa los permisos.", "danger");
                    overlay.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: var(--color-danger);"></i><span>Error al acceder a la cámara</span>';
                }
            }
        }

        function stopWebcamStream() {
            webcamActive = false;
            isPredicting = false;
            liveProbabilityHistory = [];
            if (predictionLoop) {
                clearInterval(predictionLoop);
                predictionLoop = null;
            }
            if (webcamStream) {
                webcamStream.getTracks().forEach(track => track.stop());
                webcamStream = null;
            }
        }

        function drawWebcamStream() {
            if (!webcamActive) return;
            
            const video = document.getElementById('webcamVideo');
            const canvas = document.getElementById('webcamCanvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            
            // Draw video frame mirrored for natural look
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.restore();
            
            // Draw overlay landmarks if available
            if (liveLandmarks && liveLandmarks.length > 0) {
                ctx.fillStyle = '#06b6d4';
                ctx.shadowBlur = 3;
                ctx.shadowColor = '#06b6d4';
                
                const w = canvas.width;
                const h = canvas.height;
                
                liveLandmarks.forEach(pt => {
                    ctx.beginPath();
                    // Mirror landmarks to match mirrored video display
                    ctx.arc((1 - pt.x) * w, pt.y * h, 1.2, 0, 2 * Math.PI);
                    ctx.fill();
                });
                
                ctx.shadowBlur = 0;
            }
            
            requestAnimationFrame(drawWebcamStream);
        }

        function runWebcamFrameInference() {
            if (!webcamActive || !isPredicting) return;
            
            const video = document.getElementById('webcamVideo');
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 640; // higher resolution for accurate face details
            tempCanvas.height = 480;
            
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
            
            const base64Image = tempCanvas.toDataURL('image/jpeg', 0.82);
            
            fetch('/api/train/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            })
            .then(res => res.json())
            .then(data => {
                if (!webcamActive) return; // avoid updating UI if webcam was stopped while fetching
                
                if (data.status === 'success') {
                    const probs = data.probabilities;
                    const pose = data.pose;
                    liveLandmarks = data.landmarks;
                    
                    // Add to sliding history
                    liveProbabilityHistory.push(probs);
                    while (liveProbabilityHistory.length > liveSmoothingWindow) {
                        liveProbabilityHistory.shift();
                    }
                    
                    // Compute rolling average probabilities
                    let avgProbs = { 'Atento': 0.0, 'Distraído': 0.0, 'Sospechoso': 0.0 };
                    liveProbabilityHistory.forEach(item => {
                        avgProbs['Atento'] += item['Atento'] || 0;
                        avgProbs['Distraído'] += item['Distraído'] || item['Distraido'] || 0;
                        avgProbs['Sospechoso'] += item['Sospechoso'] || 0;
                    });
                    
                    const count = liveProbabilityHistory.length;
                    avgProbs['Atento'] /= count;
                    avgProbs['Distraído'] /= count;
                    avgProbs['Sospechoso'] /= count;
                    
                    // Choose smoothed class
                    let pClass = 'Atento';
                    let maxProb = avgProbs['Atento'];
                    if (avgProbs['Distraído'] > maxProb) {
                        pClass = 'Distraído';
                        maxProb = avgProbs['Distraído'];
                    }
                    if (avgProbs['Sospechoso'] > maxProb) {
                        pClass = 'Sospechoso';
                        maxProb = avgProbs['Sospechoso'];
                    }
                    
                    const badge = document.getElementById('livePredictionBadge');
                    badge.innerText = pClass.toUpperCase();
                    
                    let color = 'var(--text-main)';
                    let glow = 'rgba(255,255,255,0.05)';
                    let bg = 'rgba(255,255,255,0.02)';
                    
                    if (pClass === 'Atento') {
                        color = 'var(--color-atento)';
                        glow = 'var(--color-atento-glow)';
                        bg = 'rgba(6, 182, 212, 0.05)';
                    } else if (pClass === 'Distraído' || pClass === 'Distraido') {
                        color = 'var(--color-distraido)';
                        glow = 'var(--color-distraido-glow)';
                        bg = 'rgba(249, 115, 22, 0.05)';
                    } else if (pClass === 'Sospechoso') {
                        color = 'var(--color-sospechoso)';
                        glow = 'var(--color-sospechoso-glow)';
                        bg = 'rgba(236, 72, 153, 0.05)';
                    }
                    
                    badge.style.color = color;
                    badge.style.textShadow = `0 0 12px ${color}`;
                    badge.parentNode.style.background = bg;
                    badge.parentNode.style.borderColor = color;
                    
                    // Update probability bars
                    ['Atento', 'Distraido', 'Sospechoso'].forEach(c => {
                        const spanishKey = c === 'Distraido' ? 'Distraído' : c;
                        const prob = avgProbs[spanishKey] || 0.0;
                        const percent = (prob * 100).toFixed(0) + '%';
                        
                        document.getElementById(`liveProb${c}`).innerText = percent;
                        document.getElementById(`liveBar${c}`).style.width = percent;
                    });
                    
                    // Update pose info
                    if (pose) {
                        document.getElementById('livePosePitch').innerText = `${pose.pitch}°`;
                        document.getElementById('livePoseYaw').innerText = `${pose.yaw}°`;
                        document.getElementById('livePoseRoll').innerText = `${pose.roll}°`;
                    } else {
                        document.getElementById('livePosePitch').innerText = '-';
                        document.getElementById('livePoseYaw').innerText = '-';
                        document.getElementById('livePoseRoll').innerText = '-';
                    }
                } else if (data.status === 'no_face') {
                    document.getElementById('livePredictionBadge').innerText = 'SIN ROSTRO';
                    document.getElementById('livePredictionBadge').style.color = 'var(--color-danger)';
                    document.getElementById('livePredictionBadge').style.textShadow = '0 0 10px rgba(239, 68, 68, 0.4)';
                    document.getElementById('livePredictionBadge').parentNode.style.background = 'rgba(239, 68, 68, 0.05)';
                    document.getElementById('livePredictionBadge').parentNode.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                    
                    liveLandmarks = null;
                    document.getElementById('livePosePitch').innerText = '-';
                    document.getElementById('livePoseYaw').innerText = '-';
                    document.getElementById('livePoseRoll').innerText = '-';
                    
                    ['Atento', 'Distraido', 'Sospechoso'].forEach(c => {
                        const cKey = c === 'Distraido' ? 'Distraido' : c;
                        document.getElementById(`liveProb${cKey}`).innerText = '0%';
                        document.getElementById(`liveBar${cKey}`).style.width = '0%';
                    });
                }
            })
            .catch(err => {
                console.error("Prediction API error:", err);
            });
        }
    </script>
</body>
</html>
