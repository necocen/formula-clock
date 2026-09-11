"""Shared CLI defaults for standalone Playwright browser suites."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def browser_args(parser, suite_file, *, browsers, standalone=False):
    parser.add_argument('--url', default=(ROOT / 'dist/standalone/index.html').as_uri()
                        if standalone else 'http://127.0.0.1:8787/')
    parser.add_argument('--browser', choices=browsers, default='chromium')
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if args.output_dir is None:
        args.output_dir = ROOT / 'test-results/browser' / Path(suite_file).stem / args.browser
    args.output_dir.mkdir(parents=True, exist_ok=True)
    return args
