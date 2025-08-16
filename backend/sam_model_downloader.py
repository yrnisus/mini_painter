#!/usr/bin/env python3
"""
backend/sam_model_downloader.py - SAM Model Checkpoint Downloader
Cross-platform script to download SAM model files
"""

import os
import sys
import urllib.request
from pathlib import Path
import hashlib

# SAM model information
SAM_MODELS = {
    'vit_h': {
        'url': 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth',
        'filename': 'sam_vit_h_4b8939.pth',
        'size_mb': 2560,  # Approximate size in MB
        'description': 'ViT-H SAM model (best quality, largest)'
    },
    'vit_l': {
        'url': 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth',
        'filename': 'sam_vit_l_0b3195.pth', 
        'size_mb': 1250,
        'description': 'ViT-L SAM model (good balance)'
    },
    'vit_b': {
        'url': 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth',
        'filename': 'sam_vit_b_01ec64.pth',
        'size_mb': 375,
        'description': 'ViT-B SAM model (fastest, smallest)'
    }
}

def download_file_with_progress(url: str, filename: str):
    """Download file with progress bar"""
    def progress_hook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, (downloaded * 100) // total_size)
            bar_length = 40
            filled_length = int(bar_length * percent // 100)
            bar = '█' * filled_length + '-' * (bar_length - filled_length)
            print(f'\r[{bar}] {percent:3d}% ({downloaded//1024//1024:,} MB)', end='', flush=True)
        else:
            print(f'\rDownloaded: {downloaded//1024//1024:,} MB', end='', flush=True)
    
    try:
        print(f"Downloading {filename}...")
        urllib.request.urlretrieve(url, filename, progress_hook)
        print(f"\n✅ Successfully downloaded {filename}")
        return True
    except Exception as e:
        print(f"\n❌ Download failed: {e}")
        return False

def verify_file_size(filename: str, expected_size_mb: int):
    """Verify downloaded file size"""
    if not os.path.exists(filename):
        return False
    
    actual_size_mb = os.path.getsize(filename) // 1024 // 1024
    expected_min = expected_size_mb * 0.95  # Allow 5% variance
    expected_max = expected_size_mb * 1.05
    
    if expected_min <= actual_size_mb <= expected_max:
        print(f"✅ File size verified: {actual_size_mb} MB")
        return True
    else:
        print(f"⚠️  File size mismatch: got {actual_size_mb} MB, expected ~{expected_size_mb} MB")
        return False

def main():
    print("🤖 SAM Model Checkpoint Downloader")
    print("=" * 50)
    
    # Create checkpoints directory
    checkpoints_dir = Path("checkpoints")
    checkpoints_dir.mkdir(exist_ok=True)
    os.chdir(checkpoints_dir)
    
    print("\nAvailable SAM models:")
    for i, (model_key, model_info) in enumerate(SAM_MODELS.items(), 1):
        print(f"{i}. {model_key.upper()}: {model_info['description']} (~{model_info['size_mb']} MB)")
    
    # Get user choice
    while True:
        try:
            choice = input(f"\nSelect model to download (1-{len(SAM_MODELS)}) or 'all' for all models: ").strip().lower()
            
            if choice == 'all':
                models_to_download = list(SAM_MODELS.keys())
                break
            else:
                choice_num = int(choice)
                if 1 <= choice_num <= len(SAM_MODELS):
                    model_key = list(SAM_MODELS.keys())[choice_num - 1]
                    models_to_download = [model_key]
                    break
                else:
                    print("Invalid choice. Please try again.")
        except ValueError:
            print("Invalid input. Please enter a number or 'all'.")
    
    # Download selected models
    print(f"\n📥 Starting download(s)...")
    
    success_count = 0
    for model_key in models_to_download:
        model_info = SAM_MODELS[model_key]
        filename = model_info['filename']
        
        print(f"\n--- Downloading {model_key.upper()} model ---")
        
        # Check if file already exists
        if os.path.exists(filename):
            if verify_file_size(filename, model_info['size_mb']):
                print(f"✅ {filename} already exists and appears valid. Skipping download.")
                success_count += 1
                continue
            else:
                print(f"⚠️  {filename} exists but appears corrupted. Re-downloading...")
                os.remove(filename)
        
        # Download the file
        if download_file_with_progress(model_info['url'], filename):
            if verify_file_size(filename, model_info['size_mb']):
                success_count += 1
            else:
                print(f"❌ Download completed but file verification failed for {filename}")
        else:
            print(f"❌ Failed to download {filename}")
    
    # Summary
    print(f"\n{'='*50}")
    print(f"Download Summary:")
    print(f"✅ Successfully downloaded: {success_count}/{len(models_to_download)} models")
    
    if success_count > 0:
        print(f"\n🎉 Ready to use! Models saved in: {os.path.abspath('.')}")
        print("\nNext steps:")
        print("1. Start the backend: python app.py")
        print("2. Open your 3D miniature painter frontend")
        print("3. Upload an STL file and click 'Process with Advanced SAM'")
    else:
        print(f"\n❌ No models downloaded successfully. Please check your internet connection and try again.")
        
        print("\n🔧 Alternative download methods:")
        print("• Manual download: Visit https://github.com/facebookresearch/segment-anything#model-checkpoints")
        print("• curl command: curl -L -o sam_vit_h_4b8939.pth https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth")
        print("• Browser download: Right-click and save the URLs shown above")

if __name__ == "__main__":
    main()