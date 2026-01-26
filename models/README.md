# YOLO 11m Object Detection Service

A Flask-based Python service for detecting objects in CCTV video footage using YOLO 11m.

## Features

- **Video Processing**: Extracts frames from uploaded videos at configurable FPS
- **YOLO 11m Detection**: Uses the YOLO 11m (medium) model for balanced speed and accuracy
- **Class Filtering**: Can filter detections to specific target classes
- **Base64 Output**: Returns detected frames as base64 images

## Setup

### 1. Create Virtual Environment

> Run from root directory

```bash
python -m venv .venv

# Windows
.\.venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r .\models\requirements.txt
```

### 3. Run the Service

```bash
python .\models\app.py
```

The service will start on `http://localhost:5000`

## API Endpoints

### Health Check

```
GET /health
```

### Detect Objects

```
POST /detect
Content-Type: multipart/form-data

Body:
- video: Video file (MP4, AVI)
- targetClasses: (optional) JSON array of class names to filter
```

### Get Supported Classes

```
GET /classes
```

## Supported Classes (COCO Dataset)

The YOLO 11m model detects 80 classes including:

| Category       | Classes                                         |
| -------------- | ----------------------------------------------- |
| Bags           | backpack, handbag, suitcase                     |
| Electronics    | laptop, cell phone, keyboard, mouse, remote, tv |
| Personal Items | umbrella, bottle, book, clock, scissors         |
| And more...    | person, chair, couch, bed, dining table, etc.   |

## Example Response

```json
{
  "success": true,
  "detections": [
    {
      "className": "backpack",
      "confidence": 0.89,
      "timestamp": "00:00:03",
      "frameIndex": 3,
      "bbox": [120, 80, 280, 320],
      "frameBase64": "data:image/jpeg;base64,..."
    }
  ],
  "processedFrames": 10,
  "totalDetections": 25,
  "filteredDetections": 3
}
```

## Notes

- The YOLO 11m model (`yolo11m.pt`) will be auto-downloaded on first run if not present
- The first request may be slow as the model is loaded at startup
- GPU acceleration requires CUDA-compatible GPU and drivers
- The service runs on port 5000 by default (configurable via `PORT` env variable)
