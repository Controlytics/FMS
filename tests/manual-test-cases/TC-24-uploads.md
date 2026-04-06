# TC-24: File Uploads — Test Cases

## Overview
- **Module**: File Upload Management
- **API Endpoints**: 2 (POST /api/uploads/photo, GET /uploads/:filename)
- **Frontend Pages**: /profile (profile photo upload)
- **Permissions**: Any authenticated user (upload), Public (retrieve)
- **Constraints**: 5MB max file size, allowed types: JPEG, PNG, GIF, WebP
- **Upload Directory**: apps/api/uploads/photos/

---

## Positive Test Cases

### TC-24-P01: Upload Profile Photo (JPEG)
- **Priority**: High
- **Preconditions**: Logged in (any role)
- **Test Data**: JPEG image file under 5MB
- **Steps**:
  1. Send POST /api/uploads/photo with multipart/form-data containing a JPEG file
  2. Verify response status is 200
  3. Verify response contains `success: true`
  4. Verify response contains `photoUrl` starting with `/uploads/photos/`
  5. Verify response contains `filename` in format `<userId>-<uuid>.jpg`
  6. Verify the file exists on disk at the returned path
- **Expected Result**: 200 OK with upload success, photoUrl pointing to the uploaded file

### TC-24-P02: Upload Profile Photo (PNG)
- **Priority**: High
- **Preconditions**: Logged in
- **Test Data**: PNG image file under 5MB
- **Steps**:
  1. Send POST /api/uploads/photo with a PNG file
  2. Verify response status is 200
  3. Verify `photoUrl` ends with `.png`
  4. Verify `filename` has `.png` extension
- **Expected Result**: 200 OK with PNG-specific filename

### TC-24-P03: Upload GIF Image
- **Priority**: Medium
- **Preconditions**: Logged in
- **Test Data**: GIF image file
- **Steps**:
  1. Send POST /api/uploads/photo with a GIF file
  2. Verify response status is 200
  3. Verify `photoUrl` ends with `.gif`
- **Expected Result**: 200 OK with GIF upload accepted

### TC-24-P04: Upload WebP Image
- **Priority**: Medium
- **Preconditions**: Logged in
- **Test Data**: WebP image file
- **Steps**:
  1. Send POST /api/uploads/photo with a WebP file
  2. Verify response status is 200
  3. Verify `photoUrl` ends with `.webp`
- **Expected Result**: 200 OK with WebP upload accepted

### TC-24-P05: Retrieve Uploaded File (Public Access)
- **Priority**: High
- **Preconditions**: File uploaded via TC-24-P01
- **Test Data**: photoUrl from TC-24-P01 response
- **Steps**:
  1. Send GET /uploads/photos/<filename> without Authorization header
  2. Verify response status is 200
  3. Verify Content-Type matches the uploaded image type (image/jpeg, image/png, etc.)
  4. Verify response body is binary image data
  5. Verify the image can be displayed in a browser
- **Expected Result**: 200 OK with image data, accessible publicly without authentication

### TC-24-P06: Upload at Size Limit (Just Under 5MB)
- **Priority**: Medium
- **Preconditions**: Logged in
- **Test Data**: Image file approximately 4.9MB
- **Steps**:
  1. Create or obtain a large JPEG image close to 5MB
  2. Send POST /api/uploads/photo with the file
  3. Verify response status is 200
  4. Verify `success: true`
- **Expected Result**: 200 OK — files at or just under the 5MB limit are accepted

### TC-24-P07: Update Profile with Uploaded Photo URL
- **Priority**: High
- **Preconditions**: File uploaded (TC-24-P01), logged in
- **Test Data**: photoUrl from upload response
- **Steps**:
  1. Upload a photo and get the photoUrl
  2. Send PUT /api/auth/profile with `{ "profilePhoto": "<photoUrl>" }`
  3. Verify profile update returns 200
  4. Send GET /api/auth/me and verify profilePhoto field contains the URL
  5. Verify the photo is displayed in the browser profile page
- **Expected Result**: Profile updated with the uploaded photo URL, visible in profile

---

## Negative Test Cases

### TC-24-N01: Upload Without Authentication
- **Priority**: High
- **Preconditions**: No JWT token
- **Test Data**: Valid JPEG file
- **Steps**:
  1. Send POST /api/uploads/photo without Authorization header, with a valid JPEG file
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized — upload requires authentication

### TC-24-N02: Upload File Exceeding 5MB
- **Priority**: High
- **Preconditions**: Logged in
- **Test Data**: Image file larger than 5MB
- **Steps**:
  1. Create a file larger than 5MB (e.g., use dd or a large image)
  2. Send POST /api/uploads/photo with the oversized file
  3. Verify response status is 400
  4. Verify error is "FILE_TOO_LARGE" or similar
- **Expected Result**: 400 Bad Request — "File exceeds maximum size of 5MB"

### TC-24-N03: Upload Non-Image File (PDF)
- **Priority**: High
- **Preconditions**: Logged in
- **Test Data**: A PDF file renamed or with original extension
- **Steps**:
  1. Send POST /api/uploads/photo with a PDF file (mimetype: application/pdf)
  2. Verify response status is 400
  3. Verify error is "INVALID_FILE_TYPE"
  4. Verify message mentions allowed types (JPEG, PNG, GIF, WebP)
- **Expected Result**: 400 Bad Request — "Only JPEG, PNG, GIF, and WebP images are allowed"

### TC-24-N04: Upload Non-Image File (Text)
- **Priority**: Medium
- **Preconditions**: Logged in
- **Test Data**: A .txt file
- **Steps**:
  1. Send POST /api/uploads/photo with a text file
  2. Verify response status is 400
  3. Verify error is "INVALID_FILE_TYPE"
- **Expected Result**: 400 Bad Request — text files not allowed

### TC-24-N05: Upload Request Without File
- **Priority**: Medium
- **Preconditions**: Logged in
- **Test Data**: Empty multipart/form-data or no Content-Type
- **Steps**:
  1. Send POST /api/uploads/photo with no file attached
  2. Verify response status is 400
  3. Verify error message indicates no file uploaded or invalid request
- **Expected Result**: 400 Bad Request — "No file uploaded" or "Request must be multipart/form-data with a file"

### TC-24-N06: Access Non-Existent Uploaded File
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: Non-existent filename
- **Steps**:
  1. Send GET /uploads/photos/nonexistent-file-12345.jpg
  2. Verify response status is 404 (or static file server returns appropriate error)
- **Expected Result**: 404 Not Found — file does not exist on disk

### TC-24-N07: Upload with Invalid Content Type Header
- **Priority**: Low
- **Preconditions**: Logged in
- **Test Data**: Request with Content-Type: application/json (not multipart/form-data)
- **Steps**:
  1. Send POST /api/uploads/photo with Content-Type: application/json and a JSON body
  2. Verify response status is 400
  3. Verify error indicates invalid request format
- **Expected Result**: 400 Bad Request — "Request must be multipart/form-data with a file"


---

## Phase 2 Notes

- File uploads remain unchanged. Profile photo upload is the primary use case.
- Phase 2 adds bulk filter upload via CSV — this uses a separate endpoint in the filter operations module, not the /api/uploads/photo endpoint.
- CSV bulk upload for filters supports columns: name, filterType, location, templateId, and custom attributes.

