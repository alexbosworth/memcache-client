MOCHA = ./node_modules/.bin/mocha
LINT  = ./node_modules/.bin/jshint

all: test lint

install:
    npm install

lint: 
	$(LINT) lib

test:
	$(MOCHA) --reporter list test/unit/*

.PHONY: install lint test


