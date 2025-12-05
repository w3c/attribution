.PHONY: all venv clean images simulator check
.SUFFIXES: .bs .html

IMAGES := $(wildcard images/*.svg)

all: build/index.html simulator

clean:
	-rm -rf build venv impl/dist

venv-marker := venv/.make
bikeshed := venv/bin/bikeshed
venv: $(venv-marker)

$(venv-marker): Makefile
	python3 -m venv venv
	@touch $@

$(bikeshed): $(venv-marker) Makefile
	venv/bin/pip install $(notdir $@)
	@touch $@

build:
	mkdir -p $@

build/index.html: api.bs $(IMAGES) build $(bikeshed)
	$(bikeshed) --die-on=warning spec $< $@

images:
	@echo "Regenerating images"
	for i in $(IMAGES); do \
	  tmp="$$(mktemp)"; \
	  npx aasvg --extract --embed <"$$i" >"$$tmp" && mv "$$tmp" "$$i"; \
	done

simulator: build/simulator.html build/simulator.js

build/simulator.html: impl/dist/index.html build
	cp $< $@

build/simulator.js: impl/dist/simulator.js build
	cp $< $@

impl/dist/index.html impl/dist/simulator.js: impl/index.html impl/package-lock.json impl/package.json impl/tsconfig.json impl/webpack.config.js impl/src/*.ts
	@ npm ci --prefix ./impl
	@ npm run pack --prefix ./impl

check:
	@ npm run --prefix ./impl pretty:check
	@ npm run --prefix ./impl build
	@ npm run --prefix ./impl test
	@ npm run --prefix ./impl validate-e2e
