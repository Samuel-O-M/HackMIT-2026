# conmed presentation — build.
#
#   make            build the deck (and everything it needs)
#   make figures    compile every figures/*/figure.tex to figure.pdf
#   make deck       compile slides/main.tex from the figure PDFs
#   make preview    render PNGs of every figure and slide (on the ground colour)
#   make clean      remove build products
#
# All commands run from presentation/. Everything is compiled with lualatex
# because the deck is set with fontspec.

LATEX   ?= lualatex
FLAGS   := -interaction=nonstopmode -halt-on-error -file-line-error

MARK    := shared/marks/conmed.pdf
FIGTEX  := $(wildcard figures/*/figure.tex)
FIGPDFS := $(patsubst %/figure.tex,%/figure.pdf,$(FIGTEX))
SLIDES  := slides/main.pdf

SHARED  := $(wildcard shared/*.tex)

.PHONY: all figures deck preview clean
all: deck

# ---- the mark asset -----------------------------------------------------
$(MARK): shared/marks/conmed.tex $(SHARED)
	@mkdir -p $(dir $@)
	$(LATEX) $(FLAGS) -output-directory=$(dir $@) $< >/dev/null || { echo "FAILED: $<"; $(LATEX) $(FLAGS) -output-directory=$(dir $@) $<; exit 1; }
	@echo "  mark    $@"

# ---- figures ------------------------------------------------------------
figures: $(FIGPDFS)

$(FIGPDFS): $(MARK)

%/figure.pdf: %/figure.tex $(SHARED) $(MARK)
	$(LATEX) $(FLAGS) -output-directory=$* $< >/dev/null || { echo "FAILED: $<"; $(LATEX) $(FLAGS) -output-directory=$* $<; exit 1; }
	@echo "  figure  $@"

# ---- deck ---------------------------------------------------------------
deck: $(SLIDES)

$(SLIDES): slides/main.tex $(FIGPDFS) $(MARK) $(SHARED)
	$(LATEX) $(FLAGS) -output-directory=slides slides/main.tex >/dev/null
	$(LATEX) $(FLAGS) -output-directory=slides slides/main.tex >/dev/null || { echo "FAILED: slides/main.tex"; $(LATEX) $(FLAGS) -output-directory=slides slides/main.tex; exit 1; }
	@echo "  deck    $@"

# ---- previews (for eyeballing / visual review) --------------------------
preview: deck
	@mkdir -p previews
	@for f in $(FIGPDFS) $(SLIDES); do \
	  out=previews/$$(echo $$f | tr '/' '_' | sed 's/\.pdf$$/.png/'); \
	  magick -density 200 "$$f" -background '#F3F5F7' -alpha remove -alpha off \
	    -colorspace sRGB "$$out"; \
	  echo "  preview $${out}"; \
	done

# ---- housekeeping -------------------------------------------------------
clean:
	rm -f $(FIGPDFS) $(MARK) $(SLIDES)
	rm -rf previews
	rm -f slides/*.aux slides/*.log slides/*.nav slides/*.snm slides/*.toc slides/*.out
	@find figures shared -name '*.aux' -delete 2>/dev/null || true
	@find figures shared -name '*.log' -delete 2>/dev/null || true
