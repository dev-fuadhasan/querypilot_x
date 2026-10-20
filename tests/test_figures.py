"""Smoke checks for Vercel's Python Matplotlib static image renderer."""
import unittest
import struct
from api.figures import render_png, prepare

BASE = {
    "title": "Verified survival rate by gender",
    "type": "bar",
    "xKey": "group_name",
    "yKeys": ["rate_pct"],
    "xLabel": "Sex",
    "yLabel": "Survival rate",
    "unit": "%",
    "rows": [
        {"group_name":"female","rate_pct":74.2,"total":314,"positive":233},
        {"group_name":"male","rate_pct":18.89,"total":577,"positive":109},
    ],
}
MULTI = {
    "title": "Measured values by month",
    "type": "line",
    "xKey": "month",
    "yKeys": ["revenue", "cost"],
    "xLabel": "Month",
    "yLabel": "Amount",
    "seriesLabels": {"revenue": "Revenue", "cost":"Cost"},
    "rows": [
        {"month":"2026-01", "revenue":100, "cost":55},
        {"month":"2026-02", "revenue":120, "cost":63},
        {"month":"2026-03", "revenue":130, "cost":70},
    ],
}

class FigureTests(unittest.TestCase):
    def check_png(self, payload):
        image = render_png(payload)
        self.assertTrue(image.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(image),1000)
        self.assertLess(len(image),4_000_000)
        self.assertGreater(struct.unpack(">I",image[16:20])[0],900)
    def test_actual_survival_bars_and_percentage(self):
        self.check_png(BASE)
        prepared = prepare(BASE)
        self.assertEqual(prepared[5], {})
        self.assertTrue(prepared[-1])
        self.assertEqual(prepared[2],["female","male"])
    def test_multiple_line_series(self):
        self.check_png(MULTI)
    def test_supported_figures(self):
        for kind in ["area","column","scatter","stacked-column","combo","heatmap","radar","card"]:
            with self.subTest(kind=kind):
                item = {**MULTI,"type":kind}
                if kind=="scatter":
                    item["xKey"]="revenue"
                    item["yKeys"]=["cost"]
                self.check_png(item)
    def test_pie_and_donut(self):
        data = {**BASE,"rows":[
            {"group_name":"Cables","rate_pct":45},
            {"group_name":"TVs","rate_pct":55}
        ],"unit":None,"yLabel":"Number of products"}
        for kind in ["pie","donut"]:
            with self.subTest(kind=kind):
                self.check_png({**data,"type":kind})
    def test_rejects_fabricated_or_non_numeric_values(self):
        with self.assertRaises(ValueError):
            render_png({**BASE,"rows":[{"group_name":"female","rate_pct":"not-a-number"}]})
        with self.assertRaises(ValueError):
            render_png({**BASE,"rows":[{"group_name":"female","rate_pct":-2}],"type":"pie"})
        with self.assertRaises(ValueError):
            render_png({**BASE,"type":"fake_kind"})
    def test_bound_input(self):
        with self.assertRaises(ValueError):
            render_png({**BASE,"rows":BASE["rows"]*101})
        with self.assertRaises(ValueError):
            render_png({**BASE,"yKeys":[]})
    def test_no_sql_or_database_operation_in_renderer(self):
        # The renderer requires data columns, not SQL, credentials or a project ID.
        payload = {**BASE,"sql":"DROP TABLE data"}
        self.check_png(payload)

if __name__=="__main__":
    unittest.main()
