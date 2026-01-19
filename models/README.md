# YOLOv8 Object Detection Service

A Flask-based Python service for detecting objects in CCTV video footage using YOLOv8.

## Features

- **Video Processing**: Extracts frames from uploaded videos at configurable FPS
- **YOLOv8 Detection**: Uses the YOLOv8n (nano) model for fast inference
- **Class Filtering**: Can filter detections to specific target classes
- **Base64 Output**: Returns detected frames as base64 images

## Setup

### 1. Create Virtual Environment

```bash
cd yolo_service
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Service

```bash
python app.py
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

The YOLOv8 model detects 80 classes including:

| Category | Classes |
|----------|---------|
| Bags | backpack, handbag, suitcase |
| Electronics | laptop, cell phone, keyboard, mouse, remote, tv |
| Personal Items | umbrella, bottle, book, clock, scissors |
| And more... | person, chair, couch, bed, dining table, etc. |

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

- The first request may be slow as the model is loaded lazily
- For demo purposes, the Node.js backend includes a simulation mode
- GPU acceleration requires CUDA-compatible GPU and drivers
