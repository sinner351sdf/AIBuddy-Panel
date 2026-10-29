fn main() { let target=std::env::var("TARGET").unwrap_or_default(); println!("cargo:rustc-env=AIBUDDY_BUILD_TARGET={target}"); }
