# Template — scripts/setup-server.sh substitutes the __PLACEHOLDER__ tokens and
# installs the result as /etc/caddy/conf.d/humboldt.caddyfile.
#
# Plain HTTP: TLS and the public hostname are handled upstream (a Cloudflare
# Tunnel, nginx, whatever you already run). Because the address is a bare port,
# Caddy never tries to obtain a certificate.
#
# setup-server.sh writes the bind line only when --bind names a specific
# address; with the default 0.0.0.0 the line is dropped and Caddy listens on
# every interface, which is what a tunnel running on ANOTHER host needs.

:__PORT__ {
	__BIND_LINE__

	# Quiz images, served LIVE from the upload directory — never from the
	# release. This route is matched before the SPA root, so a stale copy
	# baked into a release can never shadow a freshly uploaded image.
	handle_path /uploads/* {
		root * __UPLOAD_DIR__
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	# Image uploads → the Node service (server/upload).
	handle /api/upload* {
		reverse_proxy 127.0.0.1:__UPLOAD_PORT__
	}

	# The SPA itself.
	handle {
		root * __CURRENT__
		encode zstd gzip

		# Content-hashed by the build, so these can be cached forever and
		# never need a purge.
		@immutable path /assets/* /geo/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"

		# These three are fetched by name, so they must never go stale. A
		# stale shell or worker after a deploy is a miserable bug to chase.
		@nocache path /index.html /sw.js /manifest.webmanifest
		header @nocache Cache-Control "no-cache"

		try_files {path} /index.html
		file_server
	}
}
