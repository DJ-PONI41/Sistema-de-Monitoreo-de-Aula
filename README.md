# VisionProctor - Sistema de Monitoreo de Aula en Tiempo Real con IA

**VisionProctor** es una plataforma premium basada en Inteligencia Artificial y Visión Computacional diseñada para supervisar y auditar la atención y comportamiento de estudiantes en exámenes y clases virtuales. El sistema detecta desvíos de atención, somnolencia e intentos de copia en tiempo real, registrando evidencias de video en paralelo con recuadros delimitadores y etiquetas del alumno infractor.

---

## 🚀 Características Clave

1. **Monitoreo en Tiempo Real**: Inferencia de red a ~30 FPS para detectar rostros, estimar la postura de la cabeza (Pitch, Yaw, Roll) y calcular vectores de mirada.
2. **Clasificación de Comportamiento con MobileViT**: Clasificador neuronal personalizado (`mobilevit_xxs`) entrenado localmente para clasificar la pose en 3 estados: **Atento**, **Distraído** o **Copia**.
3. **Grabación de Evidencias en Buffer Circular (Pre + Post)**:
   * Al detectarse una copia, el sistema extrae automáticamente un clip de 10 segundos (5s antes y 5s después del suceso).
   * **Grabación Concurrente Multi-persona**: Múltiples alumnos pueden activar grabaciones independientes al mismo tiempo sin colisionar.
   * **Focus Highlights**: El video resultante integra de forma nativa la silueta y nombre del estudiante sospechoso encerrado en un recuadro de trampa rojo.
4. **Descargas Manuales**: Los videos se almacenan en RAM localmente para no saturar el disco ni realizar descargas invasivas. El docente decide qué videos descargar individualmente a su computadora.
5. **Configuración de ML Integrada**: Interfaz SPA para calibrar el offset de pitch de la cámara, ajustar la sensibilidad del umbral, extraer frames del dataset y entrenar el modelo neuronal localmente con curvas de aprendizaje en vivo.

---

## 📂 Estructura del Proyecto

```text
backend/
├── app/
│   ├── api/                  # Controladores y Rutas de FastAPI
│   │   ├── dataset_routes.py # Rutas para captura y gestión de dataset
│   │   ├── routes.py         # Rutas generales de visión
│   │   └── train_routes.py   # Inferencia del modelo y entrenamiento en segundo plano
│   ├── detectors/            # Lógica y modelos de Visión Computacional
│   │   ├── face_mesh_detector.py   # Malla facial MediaPipe
│   │   └── head_pose_estimator.py  # Estimación matemática de pose de la cabeza
│   ├── services/             # Lógica de negocio y orquestación
│   │   ├── camera_service.py # Captura física de fotogramas
│   │   ├── dataset_service.py# Extracción y estructuración de imágenes
│   │   ├── train_service.py  # Pipeline de PyTorch MobileViT y predicción
│   │   └── vision_service.py # Procesamiento de video OpenCV (modo standalone)
│   ├── static/               # Interfaz de Usuario SPA (Premium CSS/JS/HTML)
│   │   ├── classroom_monitoring_system.css # Hojas de estilo y animaciones
│   │   ├── classroom_monitoring_system.html# Estructura del dashboard e inbox
│   │   └── classroom_monitoring_system.js  # Lógica SPA, buffers y WebRTC
│   ├── utils/                # Utilidades de dibujo y transformaciones
│   │   ├── dataset_utils.py
│   │   └── drawing_utils.py
│   └── main.py               # Archivo de inicio del servidor FastAPI
├── dataset/                  # Carpeta del conjunto de datos y modelos (excluida del Git salvo modelos)
│   ├── mobilevit_model.pth   # Pesos entrenados del modelo MobileViT (Comenzados en Git)
│   └── training_metrics.json # Métricas históricas de precisión y pérdida (Comenzados en Git)
├── face_landmarker.task      # Archivo binario detector de MediaPipe (Comenzado en Git)
├── .gitignore                # Filtro inteligente de Git
├── requirements.txt          # Dependencias y librerías necesarias del proyecto
└── README.md                 # Este archivo informativo
```

---

## 🛠️ Instalación y Requisitos

### Requisitos Previos
* **Python 3.10+** (Recomendado).
* Una webcam conectada a la computadora (para el uso de inferencia real).

### Paso 1: Clonar el Repositorio
```bash
git clone <URL_DEL_REPOSITORIO>
cd backend
```

### Paso 2: Crear el Entorno Virtual
Crea un entorno virtual aislado para no interferir con las dependencias globales del sistema:
```bash
python -m venv venv
```

### Paso 3: Activar el Entorno Virtual
* **En Windows (PowerShell):**
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```
* **En Windows (CMD):**
  ```cmd
  .\venv\Scripts\activate.bat
  ```
* **En macOS / Linux:**
  ```bash
  source venv/bin/activate
  ```

### Paso 4: Instalar las Dependencias
Instala todas las librerías necesarias (FastAPI, PyTorch, MediaPipe, OpenCV, etc.):
```bash
pip install -r requirements.txt
```

---

## 🏃 Modo de Uso

### 1. Iniciar el Servidor de FastAPI
Ejecuta el siguiente comando en la raíz del proyecto (asegúrate de tener el entorno virtual activo):
```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Acceder a la Interfaz de Usuario
Abre tu navegador de preferencia y dirígete a:
👉 [**http://127.0.0.1:8000**](http://127.0.0.1:8000)

---

## 💡 Flujo de Trabajo en el Dashboard

* **Visualización de Cámara**:
  * Por defecto, el sistema intentará conectarse a tu webcam física.
  * Si no hay webcam o deniegas el acceso, entrará automáticamente en **Modo Simulación** (blueprint azul), fluctuando las probabilidades para probar calibraciones.
* **Auto-Grabar (Switch superior)**:
  * Debe activarse manualmente para compilar evidencias. Si está apagado, el sistema solo emitirá alertas en pantalla y pitidos pero no registrará videos en la bandeja.
* **Bandeja de Incidentes**:
  * Los videos se compilan con el buffer circular (10 segundos).
  * Si presionas el botón **Play** verás la grabación de la webcam completa con un recuadro rojo siguiendo al alumno infractor.
  * Puedes presionar **Descargar** para guardar el clip en disco en formato `.webm` o **Descartar Alerta** para borrar por completo la evidencia de la memoria RAM y limpiar la pantalla.
* **Capturar Datos y Entrenar (Configuración del Sistema)**:
  * En la pestaña **Entrenamiento MobileViT** puedes capturar nuevos rostros, elegir su clase (Atento, Distraído, Sospechoso), extraer frames e iniciar un entrenamiento completo en PyTorch viendo la gráfica de precisión en tiempo real.
