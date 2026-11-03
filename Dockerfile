FROM nginxinc/nginx-unprivileged:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY src /usr/share/nginx/html/src
COPY data /usr/share/nginx/html/data
RUN printf 'server {\n listen 8080;\n root /usr/share/nginx/html;\n add_header X-Content-Type-Options nosniff;\n add_header X-Frame-Options DENY;\n add_header Referrer-Policy no-referrer;\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK CMD wget -q --spider http://localhost:8080/ || exit 1
