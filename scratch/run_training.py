import requests
import time
import sys

base_url = "http://127.0.0.1:8000"

print("Triggering training via API...")
try:
    r = requests.post(f"{base_url}/api/train/start", params={"epochs": 15, "batch_size": 16, "lr": 2e-4})
    r.raise_for_status()
    res = r.json()
    print("API Response:", res)
    if res.get("status") != "success":
        print("Failed to start training.")
        sys.exit(1)
except Exception as e:
    print(f"Error calling start API: {e}")
    sys.exit(1)

# Polling loop
print("Monitoring training progress...")
last_percentage = -1
while True:
    try:
        r = requests.get(f"{base_url}/api/train/status")
        r.raise_for_status()
        status_data = r.json()
        
        status = status_data.get("status")
        epoch = status_data.get("current_epoch")
        total_epochs = status_data.get("total_epochs")
        train_loss = status_data.get("train_loss")
        val_loss = status_data.get("val_loss")
        val_acc = status_data.get("val_accuracy")
        percentage = status_data.get("percentage", 0)
        
        if percentage != last_percentage:
            val_acc_str = f"{val_acc:.4f}" if val_acc is not None else "N/A"
            print(f"[{percentage}%] Status: {status} | Epoch: {epoch}/{total_epochs} | Train Loss: {train_loss} | Val Loss: {val_loss} | Val Acc: {val_acc_str}")
            last_percentage = percentage
            
        if status == "completed":
            print("\nTraining completed successfully!")
            break
        elif status == "failed":
            print("\nTraining failed!")
            print("Error details:", status_data.get("error"))
            sys.exit(1)
            
    except Exception as e:
        print(f"Error checking status: {e}")
        
    time.sleep(5)

# Fetch final metrics
print("\nFetching final metrics...")
try:
    r = requests.get(f"{base_url}/api/train/metrics")
    r.raise_for_status()
    metrics_res = r.json()
    if metrics_res.get("status") == "success":
        metrics = metrics_res.get("metrics")
        print("Device Used:", metrics.get("device_used"))
        print("Final Accuracy:", metrics.get("final_accuracy"))
        print("\nClassification Report:")
        import json
        print(json.dumps(metrics.get("classification_report"), indent=4))
    else:
        print("Failed to fetch metrics:", metrics_res.get("message"))
except Exception as e:
    print("Error fetching metrics:", e)
