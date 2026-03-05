# EG-24: File Uploads — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (admin / Test@12345)
- **Tools**: curl, jq, browser, test image files (JPEG, PNG, GIF, WebP)
- **Setup**: Prepare test images of various sizes and types
- **Base URL**: http://localhost:3000

## Test File Setup
```bash
# Create test images if needed

# Small JPEG test file (create a minimal valid JPEG)
# Option 1: Use convert from ImageMagick
convert -size 100x100 xc:blue /tmp/test-photo.jpg 2>/dev/null || \
  # Option 2: Download a sample image
  curl -s -o /tmp/test-photo.jpg "https://via.placeholder.com/100.jpg" 2>/dev/null || \
  # Option 3: Use a pre-existing image on the system
  cp /usr/share/pixmaps/*.png /tmp/test-photo.png 2>/dev/null

# Create a small PNG
convert -size 100x100 xc:red /tmp/test-photo.png 2>/dev/null

# Create a file >5MB for negative tests
dd if=/dev/urandom of=/tmp/large-file.jpg bs=1M count=6 2>/dev/null

# Create a text file for invalid type test
echo "This is not an image" > /tmp/test-text.txt

# Create a fake PDF
echo "%PDF-1.4 fake pdf content" > /tmp/test-file.pdf
```

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

## Test Execution

### Test: TC-24-P01 — Upload JPEG Photo

**Browser Steps:**
1. Navigate to http://3.108.185.106/profile
2. Click on profile photo area or upload button
3. Select a JPEG image file
4. Verify upload completes and photo preview updates

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-photo.jpg;type=image/jpeg" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "success": true,
    "photoUrl": "/uploads/photos/<userId>-<uuid>.jpg",
    "filename": "<userId>-<uuid>.jpg"
  }
  ```

**Save for later tests:**
```bash
UPLOAD_RESULT=$(curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-photo.jpg;type=image/jpeg")

PHOTO_URL=$(echo "$UPLOAD_RESULT" | jq -r '.photoUrl')
FILENAME=$(echo "$UPLOAD_RESULT" | jq -r '.filename')

echo "Photo URL: $PHOTO_URL"
echo "Filename: $FILENAME"
```

**Pass/Fail:**
- [ ] success is true
- [ ] photoUrl starts with /uploads/photos/
- [ ] filename has .jpg extension

---

### Test: TC-24-P02 — Upload PNG Photo

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-photo.png;type=image/png" | jq .
```

**Pass/Fail:**
- [ ] success is true
- [ ] photoUrl ends with .png

---

### Test: TC-24-P03 — Upload GIF Image

**API (curl):**
```bash
# Create a minimal GIF if none available
# Using a 1x1 pixel GIF
printf 'GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;' > /tmp/test.gif

curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.gif;type=image/gif" | jq .
```

**Pass/Fail:**
- [ ] success is true
- [ ] photoUrl ends with .gif

---

### Test: TC-24-P04 — Upload WebP Image

**API (curl):**
```bash
# If webp conversion available
convert -size 100x100 xc:green /tmp/test.webp 2>/dev/null

curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.webp;type=image/webp" | jq .
```

**Pass/Fail:**
- [ ] success is true
- [ ] photoUrl ends with .webp

---

### Test: TC-24-P05 — Retrieve Uploaded File (Public)

**API (curl):**
```bash
# Retrieve without auth (public endpoint)
curl -s -o /dev/null -w "Status: %{http_code}\nContent-Type: %{content_type}\nSize: %{size_download}\n" \
  -X GET "http://localhost:3000$PHOTO_URL"
```

**Browser Steps:**
1. Open http://3.108.185.106/uploads/photos/<filename> directly in browser
2. Verify the image displays without login

**Expected Result:**
- 200 OK with image binary data
- Content-Type: image/jpeg (or matching type)
- No authentication required

**Pass/Fail:**
- [ ] Status is 200
- [ ] Content-Type matches image type
- [ ] Image data returned
- [ ] Works without auth token

---

### Test: TC-24-P06 — Upload at Size Limit

**API (curl):**
```bash
# Create a ~4.9MB file
dd if=/dev/urandom of=/tmp/large-photo-ok.jpg bs=1K count=4900 2>/dev/null

curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/large-photo-ok.jpg;type=image/jpeg" | jq .
```

**Pass/Fail:**
- [ ] Upload succeeds (status 200)
- [ ] File close to but under 5MB accepted

---

### Test: TC-24-P07 — Update Profile with Photo URL

**API (curl):**
```bash
# Update profile with the uploaded photo
curl -s -X PUT http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"profilePhoto\": \"$PHOTO_URL\"}" | jq .

# Verify via /me
curl -s -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '.profilePhoto'
```

**Browser Steps:**
1. Go to /profile
2. Verify the uploaded photo appears as the profile picture
3. Navigate to other pages — verify photo in header/sidebar if applicable

**Pass/Fail:**
- [ ] Profile update returns 200
- [ ] /me returns profilePhoto with correct URL
- [ ] Photo visible in browser

---

### Test: TC-24-N01 — Upload Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/uploads/photo \
  -F "file=@/tmp/test-photo.jpg;type=image/jpeg"
```

**Expected Result:**
- 401 Unauthorized

**Pass/Fail:**
- [ ] Response status is 401

---

### Test: TC-24-N02 — Upload >5MB File

**API (curl):**
```bash
# Create 6MB file
dd if=/dev/urandom of=/tmp/too-large.jpg bs=1M count=6 2>/dev/null

curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/too-large.jpg;type=image/jpeg" | jq .
```

**Expected Result:**
- 400 with FILE_TOO_LARGE error

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error mentions 5MB limit

---

### Test: TC-24-N03 — Upload PDF (Non-Image)

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-file.pdf;type=application/pdf" | jq .
```

**Expected Result:**
- 400 with INVALID_FILE_TYPE

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error is INVALID_FILE_TYPE
- [ ] Message lists allowed types

---

### Test: TC-24-N04 — Upload Text File

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-text.txt;type=text/plain" | jq .
```

**Expected Result:**
- 400 with INVALID_FILE_TYPE

**Pass/Fail:**
- [ ] Response status is 400

---

### Test: TC-24-N05 — Upload Without File

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: multipart/form-data" | jq .
```

**Expected Result:**
- 400 with "No file uploaded" or similar

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error indicates no file

---

### Test: TC-24-N06 — Access Non-Existent File

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/uploads/photos/nonexistent-file-12345.jpg
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-24-N07 — Upload with Wrong Content-Type

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/uploads/photo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": "not a file"}' | jq .
```

**Expected Result:**
- 400 with INVALID_REQUEST

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error mentions multipart/form-data

---

## Cleanup
```bash
rm -f /tmp/test-photo.jpg /tmp/test-photo.png /tmp/test.gif /tmp/test.webp \
      /tmp/large-file.jpg /tmp/large-photo-ok.jpg /tmp/too-large.jpg \
      /tmp/test-text.txt /tmp/test-file.pdf
```
