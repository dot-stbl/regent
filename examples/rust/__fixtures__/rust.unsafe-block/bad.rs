// bad.rs — `unsafe { ... }` block with no justification comment.
fn zeroed_buffer(len: usize) -> Vec<u8> {
    let mut buf = Vec::with_capacity(len);
    unsafe {
        std::ptr::write_bytes(buf.as_mut_ptr(), 0, len);
        buf.set_len(len);
    }
    buf
}