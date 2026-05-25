import { useRef, useState } from "react";
import { getAllFilesFromDrop } from "../utils/files.js";

export function Dropzone({ accept = ".jsonl,.json,.md", multiple = true, onFiles, title, description, supportFolder = true }) {
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const [active, setActive] = useState(false);
  const dragDepth = useRef(0);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setActive(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setActive(false);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setActive(false);
    let files = [];
    if (e.dataTransfer.items) {
      files = await getAllFilesFromDrop(e.dataTransfer.items);
    } else if (e.dataTransfer.files) {
      files = Array.from(e.dataTransfer.files);
    }
    if (files.length) onFiles(files);
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length) {
      onFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  return (
    <div
      className={`dropzone ${active ? "active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input ref={fileRef} type="file" accept={accept} multiple={multiple} style={{ display: "none" }} onChange={handleChange} />
      {supportFolder && (
        <input
          ref={folderRef}
          type="file"
          style={{ display: "none" }}
          webkitdirectory="true"
          directory="true"
          onChange={handleChange}
        />
      )}
      <span className="dropzone-icon">📥</span>
      <span className="dropzone-title">{title}</span>
      <span className="dropzone-desc">{description}</span>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
        <button
          className="btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current.click();
          }}
          style={{ padding: "10px 20px", fontSize: 13 }}
        >
          Browse Files
        </button>
        {supportFolder && (
          <button
            className="btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              folderRef.current.click();
            }}
            style={{ padding: "10px 20px", fontSize: 13, background: "#6366f1" }}
          >
            📁 Scan Folder
          </button>
        )}
      </div>
    </div>
  );
}
