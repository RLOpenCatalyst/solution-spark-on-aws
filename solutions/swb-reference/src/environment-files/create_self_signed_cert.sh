commonname=$(uname -n)
password=dummypassword
mkdir -p "/etc/nginx"
chmod 700 /etc/nginx
cd /etc/nginx
openssl genrsa -des3 -passout pass:$password -out cert.key 2048
#Remove passphrase from the key. Comment the line out to keep the passphrase
openssl rsa -in cert.key -passin pass:$password -out cert.key
openssl req -new -key cert.key -out cert.csr -passin pass:$password \
    -subj "/C=NA/ST=NA/L=NA/O=NA/OU=DSP/CN=$commonname/emailAddress=example.com"
openssl x509 -req -days 365 -in cert.csr -signkey cert.key -out cert.pem
cd "../../.."

# Install and configure nginx
openssl dhparam -out "/etc/nginx/dhparam.pem" 2048