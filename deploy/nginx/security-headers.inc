# Cabeçalhos de segurança (os mesmos que o Vite envia em desenvolvimento e preview).
# Incluídos em cada location: um add_header dentro de location substitui os do server.
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
