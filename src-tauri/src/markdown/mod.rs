//! Rendu Markdown « saveur Obsidian » vers HTML.
//!
//! comrak fait l'essentiel (GFM, callouts, commentaires `%%`, `==surlignage==`,
//! maths, notes de bas de page, wikilinks). L'arbre est ensuite retouché pour ce
//! qu'Obsidian affiche à sa façon : images locales, `![[intégrations]]`, `#tags`,
//! identifiants de bloc `^id` masqués et propriétés (front matter).
//!
//! Le HTML garde les attributs `data-sourcepos` : l'interface s'en sert pour
//! garder la position en passant de la lecture à l'édition.

mod properties;

use std::path::Path;
use std::sync::LazyLock;

use comrak::nodes::{AstNode, NodeHtmlBlock, NodeValue};
use comrak::{format_html, parse_document, Arena, Options};
use regex::Regex;

use crate::media::{self, Kind};
use crate::resolve::{decode, split_subpath, Resolver};

pub struct RenderOptions {
    /// Réglage Obsidian « Sauts de ligne stricts » : un simple retour à la
    /// ligne ne crée pas de saut de ligne.
    pub strict_line_breaks: bool,
}

pub fn render(markdown: &str, resolver: &Resolver, opts: &RenderOptions) -> String {
    let options = comrak_options(opts);
    let arena = Arena::new();
    let root = parse_document(&arena, markdown, &options);
    transform(&arena, root, resolver);
    let mut html = String::with_capacity(markdown.len() * 2);
    let _ = format_html(root, &options, &mut html);
    html
}

fn comrak_options(opts: &RenderOptions) -> Options<'static> {
    let mut o = Options::default();
    let e = &mut o.extension;
    e.strikethrough = true;
    e.table = true;
    e.autolink = true;
    e.tasklist = true;
    e.footnotes = true;
    e.inline_footnotes = true;
    e.front_matter_delimiter = Some("---".into());
    e.ofm_callouts = true;
    e.ofm_comments = true;
    e.math_dollars = true;
    e.wikilinks_title_after_pipe = true;
    e.highlight = true;
    e.header_id_prefix = Some(String::new());
    o.parse.relaxed_tasklist_matching = true;
    o.render.r#unsafe = true;
    o.render.hardbreaks = !opts.strict_line_breaks;
    o.render.sourcepos = true;
    o.render.tasklist_classes = true;
    o
}

enum Step {
    FrontMatter(String),
    Embed(String),
    WikiLink(String),
    Image { url: String, title: String },
    Text(String),
    Html(String),
}

fn transform<'a>(arena: &'a Arena<'a>, root: &'a AstNode<'a>, resolver: &Resolver) {
    let nodes: Vec<&'a AstNode<'a>> = root.descendants().collect();
    for node in nodes {
        // Un remplacement précédent a pu détacher ce nœud de l'arbre.
        if !node.ancestors().any(|a| a.same_node(root)) {
            continue;
        }
        let step = match &node.data().value {
            NodeValue::FrontMatter(s) => Step::FrontMatter(s.clone()),
            NodeValue::WikiLink(w) if w.embed => Step::Embed(w.url.clone()),
            NodeValue::WikiLink(w) => Step::WikiLink(w.url.clone()),
            NodeValue::Image(l) => Step::Image { url: l.url.clone(), title: l.title.clone() },
            NodeValue::Text(t) if t.contains('#') || t.contains('^') => Step::Text(t.to_string()),
            NodeValue::HtmlInline(h) if may_have_sources(h) => Step::Html(h.clone()),
            NodeValue::HtmlBlock(b) if may_have_sources(&b.literal) => Step::Html(b.literal.clone()),
            _ => continue,
        };
        match step {
            Step::FrontMatter(raw) => {
                let html = properties::render(&raw);
                node.data_mut().value = NodeValue::HtmlBlock(NodeHtmlBlock { block_type: 6, literal: html });
            }
            Step::Embed(url) => {
                let label = node.collect_text();
                detach_children(node);
                node.data_mut().value = NodeValue::HtmlInline(embed_html(&url, &label, resolver));
            }
            Step::WikiLink(url) => wikilink(arena, node, &url, resolver),
            Step::Image { url, title } => {
                let alt = node.collect_text();
                detach_children(node);
                node.data_mut().value = NodeValue::HtmlInline(image_html(&url, &alt, &title, resolver));
            }
            Step::Text(text) => text_node(arena, node, &text),
            Step::Html(html) => {
                if let Some(rewritten) = rewrite_sources(&html, resolver) {
                    match &mut node.data_mut().value {
                        NodeValue::HtmlInline(h) => *h = rewritten,
                        NodeValue::HtmlBlock(b) => b.literal = rewritten,
                        _ => {}
                    }
                }
            }
        }
    }
}

fn detach_children<'a>(node: &'a AstNode<'a>) {
    for child in node.children().collect::<Vec<_>>() {
        child.detach();
    }
}

fn html_node<'a>(arena: &'a Arena<'a>, html: String) -> &'a AstNode<'a> {
    arena.alloc(NodeValue::HtmlInline(html).into())
}

/// `[[note|alias]]` → lien interne, marqué « non résolu » si la note manque.
fn wikilink<'a>(arena: &'a Arena<'a>, node: &'a AstNode<'a>, url: &str, resolver: &Resolver) {
    let (target, subpath) = split_subpath(url);
    let resolved = if target.is_empty() { None } else { resolver.resolve_note(target) };
    let unresolved = !target.is_empty() && resolved.is_none();
    let mut open = format!(
        "<a href=\"{0}\" class=\"internal-link{1}\" data-href=\"{0}\"",
        esc(url),
        if unresolved { " is-unresolved" } else { "" }
    );
    if let Some(path) = &resolved {
        open.push_str(&format!(" data-path=\"{}\"", esc(&path.to_string_lossy())));
    }
    open.push('>');

    // Sans alias, Obsidian affiche « note > Titre ».
    if !subpath.is_empty() && node.collect_text() == url {
        if let Some(text) = node.first_child() {
            let shown = format!("{target}{}{}", if target.is_empty() { "" } else { " > " }, subpath.trim_start_matches(['#', '^']));
            text.data_mut().value = NodeValue::Text(shown.into());
        }
    }

    node.insert_before(html_node(arena, open));
    for child in node.children().collect::<Vec<_>>() {
        node.insert_before(child);
    }
    node.insert_before(html_node(arena, "</a>".into()));
    node.detach();
}

/// `![[fichier]]` : image, son, vidéo ou PDF affiché ; note intégrée en vignette.
fn embed_html(url: &str, label: &str, resolver: &Resolver) -> String {
    let (target, subpath) = split_subpath(url);
    let alias = if label == url { "" } else { label };
    if let Some(kind) = media::kind(Path::new(target)) {
        let Some(path) = resolver.resolve_file(target) else {
            return format!(
                "<span class=\"internal-embed embed-missing\"><span data-icon=\"image-off\"></span>« {} » introuvable</span>",
                esc(target)
            );
        };
        let src = esc(&media::url_for(&path));
        return match kind {
            Kind::Image => {
                let (alt, size) = parse_size(alias);
                let alt = if alt.is_empty() { crate::files::file_name(Path::new(target)) } else { alt };
                format!("<img class=\"internal-embed image-embed\" src=\"{src}\" alt=\"{}\"{size} loading=\"lazy\">", esc(&alt))
            }
            Kind::Audio => format!("<audio class=\"internal-embed media-embed\" controls preload=\"metadata\" src=\"{src}\"></audio>"),
            Kind::Video => {
                let (_, size) = parse_size(alias);
                format!("<video class=\"internal-embed media-embed\" controls preload=\"metadata\" src=\"{src}\"{size}></video>")
            }
            Kind::Pdf => format!("<iframe class=\"internal-embed pdf-embed\" src=\"{src}\"></iframe>"),
        };
    }

    let resolved = if target.is_empty() { None } else { resolver.resolve_note(target) };
    let title = if !alias.is_empty() {
        alias.to_string()
    } else if subpath.is_empty() {
        target.to_string()
    } else {
        format!("{target} > {}", subpath.trim_start_matches(['#', '^']))
    };
    let mut html = format!(
        "<span class=\"markdown-embed internal-embed{}\" data-href=\"{}\"",
        if resolved.is_none() && !target.is_empty() { " is-unresolved" } else { "" },
        esc(url)
    );
    if let Some(path) = resolved {
        html.push_str(&format!(" data-path=\"{}\"", esc(&path.to_string_lossy())));
    }
    html.push_str(&format!(
        "><span class=\"markdown-embed-icon\" data-icon=\"file-text\"></span><span class=\"markdown-embed-title\">{}</span></span>",
        esc(&title)
    ));
    html
}

/// `![alt|300](image.png)` : taille Obsidian, chemin local servi par `vmedia`.
fn image_html(url: &str, alt: &str, title: &str, resolver: &Resolver) -> String {
    let (alt, size) = parse_size(alt);
    let src = media_src(url, resolver);
    let mut html = format!("<img src=\"{}\" alt=\"{}\"{size}", esc(&src), esc(&alt));
    if !title.is_empty() {
        html.push_str(&format!(" title=\"{}\"", esc(title)));
    }
    html.push_str(" loading=\"lazy\">");
    html
}

static SIZE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:(?P<alt>.*)\|)?\s*(?P<w>\d+)(?:x(?P<h>\d+))?\s*$").unwrap());

/// Sépare « texte|300x200 » en texte et attributs de taille.
fn parse_size(spec: &str) -> (String, String) {
    match SIZE.captures(spec) {
        Some(c) => {
            let alt = c.name("alt").map(|m| m.as_str().to_string()).unwrap_or_default();
            let mut size = format!(" width=\"{}\"", &c["w"]);
            if let Some(h) = c.name("h") {
                size.push_str(&format!(" height=\"{}\"", h.as_str()));
            }
            (alt, size)
        }
        None => (spec.to_string(), String::new()),
    }
}

static SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9+.\-]+:").unwrap());

/// URL d'un média : distante telle quelle, locale convertie en `vmedia`.
fn media_src(url: &str, resolver: &Resolver) -> String {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("javascript:") || lower.starts_with("vbscript:") {
        return String::new();
    }
    if let Some(rest) = url.strip_prefix("file:///") {
        let path = decode(rest);
        let path = if cfg!(windows) { path } else { format!("/{path}") };
        return media::url_for(Path::new(&path));
    }
    if SCHEME.is_match(url) || url.starts_with("//") {
        return url.to_string();
    }
    let decoded = decode(url);
    match resolver.resolve_file(&decoded) {
        Some(path) => media::url_for(&path),
        None => url.to_string(),
    }
}

fn may_have_sources(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    lower.contains("src=") && ["<img", "<video", "<audio", "<source", "<iframe", "<embed"].iter().any(|t| lower.contains(t))
}

static SRC_ATTR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(<(?:img|video|audio|source|iframe|embed)\b[^>]*?\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)')"#).unwrap()
});

/// Réécrit les `src` relatifs du HTML brut (`<img src="image.png">`).
fn rewrite_sources(html: &str, resolver: &Resolver) -> Option<String> {
    let mut changed = false;
    let out = SRC_ATTR.replace_all(html, |c: &regex::Captures| {
        let url = c.get(2).or_else(|| c.get(3)).map(|m| m.as_str()).unwrap_or("");
        let src = media_src(&unescape_attr(url), resolver);
        if src != url {
            changed = true;
        }
        format!("{}\"{}\"", &c[1], esc(&src))
    });
    changed.then(|| out.into_owned())
}

fn unescape_attr(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

static BLOCK_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|\s+)\^[A-Za-z0-9\-]+\s*$").unwrap());

/// `#tags` en étiquettes ; `^identifiant` de bloc masqué en fin de paragraphe.
fn text_node<'a>(arena: &'a Arena<'a>, node: &'a AstNode<'a>, text: &str) {
    let in_link = node.ancestors().skip(1).any(|a| {
        matches!(a.data().value, NodeValue::Link(_) | NodeValue::WikiLink(_) | NodeValue::Image(_))
    });
    if in_link {
        return;
    }

    let mut text = text.to_string();
    let mut changed = false;
    if node.next_sibling().is_none() && BLOCK_ID.is_match(&text) {
        text = BLOCK_ID.replace(&text, "").into_owned();
        changed = true;
    }

    let line_start = match node.previous_sibling() {
        None => true,
        Some(prev) => matches!(prev.data().value, NodeValue::SoftBreak | NodeValue::LineBreak),
    };
    let segments = split_tags(&text, line_start);
    if segments.len() == 1 && !changed {
        return;
    }
    for segment in segments {
        let new = match segment {
            Segment::Text(t) if t.is_empty() => continue,
            Segment::Text(t) => arena.alloc(NodeValue::Text(t.into()).into()),
            Segment::Tag(tag) => html_node(
                arena,
                format!("<a href=\"#{0}\" class=\"tag\" data-tag=\"{0}\">#{0}</a>", esc(&tag)),
            ),
        };
        node.insert_before(new);
    }
    node.detach();
}

#[derive(Debug, PartialEq)]
enum Segment {
    Text(String),
    Tag(String),
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

fn split_tags(text: &str, line_start: bool) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut i = 0;
    while i < chars.len() {
        let (pos, c) = chars[i];
        let after_space = if i == 0 { line_start } else { chars[i - 1].1.is_whitespace() };
        if c == '#' && after_space {
            let start = pos + 1;
            let mut j = i + 1;
            while j < chars.len() && is_tag_char(chars[j].1) {
                j += 1;
            }
            let end = if j < chars.len() { chars[j].0 } else { text.len() };
            let tag = text[start..end].trim_end_matches('/');
            if !tag.is_empty() && tag.chars().any(|c| !c.is_ascii_digit()) {
                segments.push(Segment::Text(std::mem::take(&mut current)));
                segments.push(Segment::Tag(tag.to_string()));
                current.push_str(&text[start + tag.len()..end]);
                i = j;
                continue;
            }
        }
        current.push(c);
        i += 1;
    }
    segments.push(Segment::Text(current));
    segments
}

pub(crate) fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::IndexCache;

    fn html(md: &str) -> String {
        let cache = IndexCache::default();
        let resolver = Resolver::new(None, &cache);
        render(md, &resolver, &RenderOptions { strict_line_breaks: false })
    }

    #[test]
    fn callouts() {
        let out = html("> [!warning]- Attention **ici**\n> Contenu\n");
        assert!(out.contains("class=\"callout\" data-callout=\"warning\""), "{out}");
        assert!(out.contains("data-callout-fold=\"collapsed\""), "{out}");
        assert!(out.contains(">ici</strong>"), "{out}");
        assert!(out.contains("callout-content"), "{out}");
    }

    #[test]
    fn obsidian_inline_syntax() {
        let out = html("Un ==surlignage== et %%caché%% puis $x^2$.\n");
        assert!(out.contains(">surlignage</mark>"), "{out}");
        assert!(!out.contains("caché"), "{out}");
        assert!(out.contains("data-math-style=\"inline\""), "{out}");
    }

    #[test]
    fn tags_and_block_ids() {
        let out = html("#projet du texte #a/b et C# ou #123 ^abc-1\n");
        assert!(out.contains("class=\"tag\" data-tag=\"projet\""), "{out}");
        assert!(out.contains("data-tag=\"a/b\""), "{out}");
        assert!(!out.contains("data-tag=\"123\""), "{out}");
        assert!(out.contains("C#"), "{out}");
        assert!(!out.contains("^abc-1"), "{out}");
    }

    #[test]
    fn wikilinks_and_embeds() {
        let out = html("Voir [[Autre note|ici]] et [[Note#Titre]].\n\n![[image absente.png|200]]\n");
        assert!(out.contains("class=\"internal-link is-unresolved\""), "{out}");
        assert!(out.contains(">ici</a>"), "{out}");
        assert!(out.contains(">Note &gt; Titre</a>") || out.contains(">Note > Titre</a>"), "{out}");
        assert!(out.contains("embed-missing"), "{out}");
    }

    #[test]
    fn image_size() {
        let out = html("![Logo|120x40](https://exemple.org/logo.png)\n");
        assert!(out.contains("src=\"https://exemple.org/logo.png\""), "{out}");
        assert!(out.contains("alt=\"Logo\" width=\"120\" height=\"40\""), "{out}");
    }

    #[test]
    fn front_matter_properties() {
        let out = html("---\ntitle: Essai\ntags:\n  - un\n  - deux\nfait: true\n---\n# Titre\n");
        assert!(out.contains("metadata-container"), "{out}");
        assert!(out.contains("data-property-key=\"tags\""), "{out}");
        assert!(out.contains(">deux<"), "{out}");
        assert!(out.contains("<h1 id=\"titre\""), "{out}");
        // Les numéros de ligne comptent le front matter (synchronisation lecture/édition).
        assert!(out.contains("data-sourcepos=\"8:1-8:7\""), "{out}");
    }

    #[test]
    fn tasks_and_sourcepos() {
        let out = html("- [ ] à faire\n- [x] fait\n");
        assert!(out.contains("task-list-item"), "{out}");
        assert!(out.contains("data-sourcepos=\"1:1"), "{out}");
    }

    #[test]
    fn split_tags_rules() {
        assert_eq!(
            split_tags("a #b c", false),
            vec![Segment::Text("a ".into()), Segment::Tag("b".into()), Segment::Text(" c".into())]
        );
        assert_eq!(split_tags("#b", false), vec![Segment::Text("#b".into())]);
        assert_eq!(split_tags("x#b", true), vec![Segment::Text("x#b".into())]);
    }
}
