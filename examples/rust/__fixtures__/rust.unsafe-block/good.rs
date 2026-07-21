// good.rs — `unsafe { ... }` block preceded by a `// unsafe-allow` comment.
fn zeroed_buffer(len: usize) -> Vec<u8> {
    let mut buf = Vec::with_capacity(len);
    // unsafe-allow: zero-init via set_len after write_bytes; len == cap == initialised.
    unsafe {
        std::ptr::write_bytes(buf.as_mut_ptr(), 0, len);
        buf.set_len(len);
    }
    buf
}