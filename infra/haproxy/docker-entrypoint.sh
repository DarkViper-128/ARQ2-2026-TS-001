#!/bin/sh
# Entrypoint script for HAProxy - substitutes environment variables in config

set -e

# Copy config to writable location
cp /usr/local/etc/haproxy/haproxy.cfg /tmp/haproxy.cfg

# Substitute environment variables using sed
# Handle ${VAR:-default} syntax
for var in $(env | grep -E '^[A-Z_]+=' | cut -d= -f1); do
    value=$(eval echo \$$var)
    # Escape special regex characters in value
    escaped_value=$(printf '%s\n' "$value" | sed 's/[[\.*^$()+?{|\\]/\\&/g')
    # Replace ${VAR:-default} or ${VAR} with value
    sed -i "s|\${$var:-.*}|$escaped_value|g; s|\${$var}|$escaped_value|g" /tmp/haproxy.cfg
done

# Execute the original entrypoint with our modified config
exec docker-entrypoint.sh -f /tmp/haproxy.cfg "$@"