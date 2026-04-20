FROM nginx:1.25-alpine

# Remove the default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom config
COPY nginx.conf /etc/nginx/conf.d/slackathon.conf

# Expose port 80 (HTTP for Phase 1; Phase 2 adds 443/HTTPS)
EXPOSE 80

# Nginx runs as non-root in the base image (nginx user, uid 101)
# No additional security setup needed for Phase 1.

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/nginx-health || exit 1
