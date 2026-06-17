import os
import torch
import timm
from torchvision import transforms
import PIL.Image as Image

classes = ["Atento", "Distraido", "Sospechoso"]
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Load model
model = timm.create_model('mobilevit_xxs', pretrained=False, num_classes=3)
model_path = "dataset/mobilevit_model.pth"

if not os.path.exists(model_path):
    print("Model file not found!")
    exit(1)

model.load_state_dict(torch.load(model_path, map_location=device))
model = model.to(device)
model.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

folder = "dataset/Atento"
files = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.png'))][:50]

print(f"Testing {len(files)} files from {folder}...")

counts = {c: 0 for c in classes}
for f in files:
    try:
        img = Image.open(f).convert('RGB')
        tensor = transform(img).unsqueeze(0).to(device)
        with torch.no_grad():
            outputs = model(tensor)
            pred_idx = torch.argmax(outputs, dim=1).item()
            pred_class = classes[pred_idx]
            counts[pred_class] += 1
    except Exception as e:
        print(f"Error on {f}: {e}")

print("Prediction counts:")
for c, cnt in counts.items():
    print(f"  {c}: {cnt}")
