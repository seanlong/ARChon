# ARChon
Fork from https://bitbucket.org/vladikoff/archon/ without NaCl binaries.

This is an attempt to run Android APK without using Chrome extension.

**Steps:**  
1. apply the chrome_patches/*(change hard codede the CRX fs path), then build the chrome  
2. run HTTP server on the root directory, like $python SimpleHTTPServer 7788  
3. load localhost:7788/main.html to install the app(is this mandatory?). Some switches may help: --unlimited-storage --allow-file-access-from-files --allow-file-access.
4. load localhost:7788/index.html to run the app
