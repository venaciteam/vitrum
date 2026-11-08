//! Affiche le HTML produit pour un fichier Markdown (débogage, aperçu navigateur).
//!
//! `cargo run --example render -- ../dev/exemple.md > ../dev/exemple.html`

use std::path::PathBuf;

use vitrum_lib::markdown::{render, RenderOptions};
use vitrum_lib::resolve::{IndexCache, Resolver};

fn main() {
    let path = PathBuf::from(std::env::args().nth(1).expect("usage : render <fichier.md>"));
    let content = std::fs::read_to_string(&path).expect("lecture impossible");
    let content = content.replace("\r\n", "\n");
    let cache = IndexCache::default();
    let resolver = Resolver::new(Some(&path), &cache);
    print!("{}", render(&content, &resolver, &RenderOptions { strict_line_breaks: false }));
}
