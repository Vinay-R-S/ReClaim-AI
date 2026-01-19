import cv2
import numpy as np
import base64
import os
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Load YOLOv8 model (Medium)
# It will download 'yolov8m.pt' on first run if not present
try:
    model = YOLO("yolov8m.pt")
    print("✅ YOLOv8m model loaded successfully")
except Exception as e:
    print(f"❌ Failed to load YOLO model: {e}")
    # Fallback or exit? For now just print error
    model = None

# COCO Class mapping (idx -> name) is handled internally by Ultralytics, 
# but we can filter results if needed.

def base64_to_image(base64_string):
    """Convert base64 string to numpy image"""
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    
    image_bytes = base64.decodebytes(base64_string.encode())
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return image

def image_to_base64(image):
    """Convert numpy image to base64 string"""
    _, buffer = cv2.imencode('.jpg', image)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode()}"

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model": "yolov8m"})

@app.route('/detect', methods=['POST'])
def detect():
    """
    Detect objects in a single image frame (base64) 
    or a video file (not fully implemented for streaming yet, focused on single frame/client-side capture)
    """
    if not model:
        return jsonify({"error": "Model not loaded"}), 500

    try:
        data = request.json
        
        # Mode 1: Single Frame (Webcam or Client-side extracted video frame)
        if 'image' in data:
            image_b64 = data['image']
            target_classes = data.get('targetClasses', []) # List of class names to filter
            
            # Decode image
            frame = base64_to_image(image_b64)
            if frame is None:
                return jsonify({"error": "Invalid image data"}), 400

            # Run inference
            results = model(frame)
            
            detections = []
            
            # Process results
            for r in results:
                boxes = r.boxes
                for box in boxes:
                    cls_id = int(box.cls[0])
                    class_name = model.names[cls_id]
                    confidence = float(box.conf[0])
                    
                    # Filter by target classes if provided
                    if target_classes and class_name not in target_classes:
                        continue
                        
                    # Filter low confidence
                    if confidence < 0.3:
                        continue

                    # Bounding Box
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    
                    # Crop object for "Register as Found" feature
                    # Ensure coordinates are within bounds
                    h, w = frame.shape[:2]
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w, x2), min(h, y2)
                    
                    cropped_obj = frame[y1:y2, x1:x2]
                    cropped_b64 = None
                    if cropped_obj.size > 0:
                        cropped_b64 = image_to_base64(cropped_obj)

                    detections.append({
                        "className": class_name,
                        "confidence": round(confidence, 2),
                        "bbox": [x1, y1, x2, y2],
                        "croppedImage": cropped_b64
                    })

            return jsonify({
                "success": True,
                "detections": detections,
                "count": len(detections)
            })
            
        # Mode 2: Video File (Basic implementation - extract frames @ 1FPS)
        elif 'video' in data:
             # This is heavy for a simple request. 
             # Ideally client extracts frames and sends them one by one.
             # But for completeness:
             return jsonify({"error": "Video upload processing handled on client-side for this MVP. Send frames individually."}), 400

        else:
            return jsonify({"error": "No image provided"}), 400

    except Exception as e:
        print(f"Detection error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
