FROM haproxy:2.8-alpine

# Copy config and entrypoint script
COPY infra/haproxy/haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg
COPY infra/haproxy/docker-entrypoint.sh /docker-entrypoint.sh

# Use custom entrypoint (called via sh to avoid execute permission issues)
ENTRYPOINT ["sh", "/docker-entrypoint.sh"]
CMD ["haproxy", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]