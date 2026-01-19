import cv2
import numpy as np
import base64
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

# Load YOLOv8 model
try:
    model = YOLO("yolov8m.pt")
    print("YOLOv8m model loaded successfully")
except Exception as e:
    print(f"Failed to load YOLO model: {e}")
    model = None

def base64_to_image(base64_string):
    """Convert base64 string to numpy image"""
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    image_bytes = base64.decodebytes(base64_string.encode())
    nparr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def image_to_base64(image):
    """Convert numpy image to base64 string"""
    _, buffer = cv2.imencode('.jpg', image)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode()}"

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model": "yolov8m"})

@app.route('/detect', methods=['POST'])
def detect():
    """Detect objects in a single image frame"""
    if not model:
        return jsonify({"error": "Model not loaded"}), 500

    try:
        data = request.json
        
        if 'image' not in data:
            return jsonify({"error": "No image provided"}), 400
            
        image_b64 = data['image']
        target_classes = data.get('targetClasses', [])
        
        frame = base64_to_image(image_b64)
        if frame is None:
            return jsonify({"error": "Invalid image data"}), 400

        results = model(frame)
        detections = []
        
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                class_name = model.names[cls_id]
                confidence = float(box.conf[0])
                
                if target_classes and class_name not in target_classes:
                    continue
                if confidence < 0.3:
                    continue

                x1, y1, x2, y2 = map(int, box.xyxy[0])
                h, w = frame.shape[:2]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                
                cropped_obj = frame[y1:y2, x1:x2]
                cropped_b64 = image_to_base64(cropped_obj) if cropped_obj.size > 0 else None

                detections.append({
                    "className": class_name,
                    "confidence": round(confidence, 2),
                    "bbox": [x1, y1, x2, y2],
                    "croppedImage": cropped_b64
                })

        return jsonify({"success": True, "detections": detections, "count": len(detections)})

    except Exception as e:
        print(f"Detection error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/analyze-video', methods=['POST'])
def analyze_video():
    """Analyze video frames to find target object"""
    if not model:
        return jsonify({"error": "Model not loaded"}), 500

    try:
        data = request.json
        frames = data.get('frames', [])
        target_class = data.get('targetClass', '').lower()
        item_name = data.get('itemName', '')
        item_description = data.get('itemDescription', '')

        if not frames:
            return jsonify({"error": "No frames provided"}), 400

        keyframes = []
        all_confidences = []

        for frame_data in frames:
            image_b64 = frame_data.get('image', '')
            timestamp = frame_data.get('timestamp', 0)
            if not image_b64:
                continue

            frame = base64_to_image(image_b64)
            if frame is None:
                continue

            results = model(frame)
            frame_detections = []
            best_confidence = 0

            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    class_name = model.names[cls_id].lower()
                    confidence = float(box.conf[0])

                    if target_class and target_class not in class_name and class_name not in target_class:
                        continue
                    if confidence < 0.3:
                        continue

                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    h, w = frame.shape[:2]
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w, x2), min(h, y2)

                    cropped_obj = frame[y1:y2, x1:x2]
                    cropped_b64 = image_to_base64(cropped_obj) if cropped_obj.size > 0 else None

                    frame_detections.append({
                        "className": model.names[cls_id],
                        "confidence": round(confidence, 2),
                        "bbox": [x1, y1, x2, y2],
                        "croppedImage": cropped_b64
                    })

                    if confidence > best_confidence:
                        best_confidence = confidence

            if frame_detections:
                all_confidences.append(best_confidence)
                keyframes.append({
                    "timestamp": round(timestamp, 2),
                    "frameImage": image_b64,
                    "confidence": round(best_confidence, 2),
                    "detections": frame_detections
                })

        avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0
        max_confidence = max(all_confidences) if all_confidences else 0
        keyframes.sort(key=lambda x: x['confidence'], reverse=True)
        keyframes = keyframes[:10]

        return jsonify({
            "success": True,
            "keyframes": keyframes,
            "stats": {
                "totalFramesAnalyzed": len(frames),
                "framesWithTarget": len(keyframes),
                "averageConfidence": round(avg_confidence, 2),
                "maxConfidence": round(max_confidence, 2)
            },
            "targetClass": target_class,
            "itemName": item_name,
            "itemDescription": item_description
        })

    except Exception as e:
        print(f"Video analysis error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
