//! Propriétés d'une note (front matter YAML), affichées comme dans Obsidian.

use std::sync::LazyLock;

use regex::Regex;
use yaml_rust2::{Yaml, YamlLoader};

use super::esc;

static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());
static DATETIME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}").unwrap());

pub fn render(front_matter: &str) -> String {
    let body = strip_fences(front_matter);
    if body.trim().is_empty() {
        return String::new();
    }
    let map = match YamlLoader::load_from_str(&body) {
        Ok(docs) => match docs.into_iter().next() {
            Some(Yaml::Hash(map)) => map,
            _ => return invalid(&body),
        },
        Err(_) => return invalid(&body),
    };

    let mut out = String::from(
        "<div class=\"metadata-container\"><div class=\"metadata-properties-heading\">\
         <span class=\"metadata-properties-title\">Propriétés</span></div><div class=\"metadata-properties\">",
    );
    for (key, value) in map.iter() {
        let key = display(key);
        let (icon, value_html) = value_html(&key, value);
        out.push_str(&format!(
            "<div class=\"metadata-property\" data-property-key=\"{k}\">\
             <div class=\"metadata-property-key\"><span class=\"metadata-property-icon\" data-icon=\"{icon}\"></span>\
             <span class=\"metadata-property-key-text\">{k}</span></div>\
             <div class=\"metadata-property-value\">{value_html}</div></div>",
            k = esc(&key)
        ));
    }
    out.push_str("</div></div>");
    out
}

fn strip_fences(front_matter: &str) -> String {
    let mut lines: Vec<&str> = front_matter.lines().collect();
    if lines.first().is_some_and(|l| l.trim() == "---") {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if lines.last().is_some_and(|l| matches!(l.trim(), "---" | "...")) {
        lines.pop();
    }
    lines.join("\n")
}

fn invalid(body: &str) -> String {
    format!(
        "<div class=\"metadata-container is-invalid\"><div class=\"metadata-properties-heading\">\
         <span class=\"metadata-properties-title\">Propriétés illisibles (YAML invalide)</span></div>\
         <pre class=\"metadata-raw\"><code>{}</code></pre></div>",
        esc(body)
    )
}

fn value_html(key: &str, value: &Yaml) -> (&'static str, String) {
    let lower = key.to_lowercase();
    let is_tags = matches!(lower.as_str(), "tags" | "tag");
    let is_aliases = matches!(lower.as_str(), "aliases" | "alias");
    match value {
        Yaml::Array(items) => {
            let icon = if is_tags { "tags" } else if is_aliases { "forward" } else { "list" };
            (icon, pills(items.iter().map(display), is_tags))
        }
        Yaml::String(s) if is_tags => {
            ("tags", pills(s.split([',', ' ']).filter(|t| !t.is_empty()).map(str::to_string), true))
        }
        Yaml::String(s) => {
            let icon = if DATE.is_match(s) {
                "calendar"
            } else if DATETIME.is_match(s) {
                "clock"
            } else {
                "align-left"
            };
            (icon, text_value(s))
        }
        Yaml::Boolean(b) => (
            "square-check",
            format!("<input type=\"checkbox\" class=\"metadata-checkbox\" disabled{}>", if *b { " checked" } else { "" }),
        ),
        Yaml::Integer(_) | Yaml::Real(_) => ("hash", format!("<span class=\"metadata-text\">{}</span>", esc(&display(value)))),
        Yaml::Null => ("align-left", String::new()),
        _ => ("braces", format!("<code>{}</code>", esc(&display(value)))),
    }
}

fn pills(items: impl Iterator<Item = String>, tags: bool) -> String {
    let mut out = String::from("<div class=\"metadata-pills\">");
    for item in items {
        let item = item.trim_start_matches('#');
        if tags {
            out.push_str(&format!("<a href=\"#{0}\" class=\"tag metadata-pill\" data-tag=\"{0}\">{0}</a>", esc(item)));
        } else {
            out.push_str(&format!("<span class=\"metadata-pill\">{}</span>", inline_value(item)));
        }
    }
    out.push_str("</div>");
    out
}

fn text_value(s: &str) -> String {
    format!("<span class=\"metadata-text\">{}</span>", inline_value(s))
}

/// `[[note]]` en lien interne, URL en lien externe, sinon texte échappé.
fn inline_value(s: &str) -> String {
    if let Some(inner) = s.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
        let (target, alias) = inner.split_once('|').unwrap_or((inner, inner));
        return format!("<a class=\"internal-link\" href=\"{0}\" data-href=\"{0}\">{1}</a>", esc(target), esc(alias));
    }
    if s.starts_with("http://") || s.starts_with("https://") {
        return format!("<a class=\"external-link\" href=\"{0}\">{0}</a>", esc(s));
    }
    esc(s)
}

fn display(value: &Yaml) -> String {
    match value {
        Yaml::String(s) | Yaml::Real(s) => s.clone(),
        Yaml::Integer(i) => i.to_string(),
        Yaml::Boolean(b) => b.to_string(),
        Yaml::Null => String::new(),
        Yaml::Array(items) => format!("[{}]", items.iter().map(display).collect::<Vec<_>>().join(", ")),
        Yaml::Hash(map) => format!(
            "{{{}}}",
            map.iter().map(|(k, v)| format!("{}: {}", display(k), display(v))).collect::<Vec<_>>().join(", ")
        ),
        _ => String::new(),
    }
}
