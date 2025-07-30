import React, { useRef } from 'react';
import { Upload } from 'lucide-react';

interface FileUploadProps {
  onFileUpload: (file: File) => void;
  isLoading: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, isLoading }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj"
        onChange={(e) => e.target.files?.[0] && onFileUpload(e.target.files[0])}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px',
          background: isLoading ? '#9CA3AF' : 'linear-gradient(to right, #3B82F6, #8B5CF6)',
          color: 'white', borderRadius: '8px', border: 'none',
          cursor: isLoading ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: '500'
        }}
      >
        <Upload size={20} />
        {isLoading ? 'Processing...' : 'Upload STL Model'}
      </button>
    </div>
  );
};

export default FileUpload;