import React, { useRef, useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';

interface FileUploadProps {
  onFileUpload: (file: File) => void;
  onAnalysisComplete: (analysisData: any) => void;
  isLoading: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  onFileUpload, 
  onAnalysisComplete, 
  isLoading 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    console.log('File selected:', file.name);
    setError(null);
    
    try {
      // Only handle the file upload for 3D display - NO AUTOMATIC BACKEND ANALYSIS
      console.log('Calling onFileUpload only...');
      onFileUpload(file);
      
      // Don't send to backend automatically anymore
      // User can manually trigger SAM analysis with the button
      console.log('✅ File loaded for 3D display - no automatic analysis');
      
      // Call onAnalysisComplete with fallback data (no backend analysis)
      onAnalysisComplete({
        success: false,
        message: 'File loaded - use SAM button for AI analysis',
        fallback: true
      });
      
    } catch (error) {
      console.error('Error in handleFileSelect:', error);
      setError(`File processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj"
        onChange={(e) => {
          const file = e.target.files?.[0];
          console.log('Input changed, file:', file);
          if (file) {
            handleFileSelect(file);
          }
        }}
        style={{ display: 'none' }}
      />
      
      <button
        onClick={() => {
          console.log('Upload button clicked');
          fileInputRef.current?.click();
        }}
        disabled={isLoading}
        style={{
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          padding: '12px 24px',
          background: isLoading ? '#9CA3AF' : 'linear-gradient(to right, #3B82F6, #8B5CF6)',
          color: 'white', 
          borderRadius: '8px', 
          border: 'none',
          cursor: isLoading ? 'not-allowed' : 'pointer', 
          fontSize: '16px', 
          fontWeight: '500',
          minWidth: '200px'
        }}
      >
        <Upload size={20} />
        {isLoading ? 'Loading Model...' : 'Upload STL Model'}
      </button>

      {error && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: '6px',
          fontSize: '14px',
          color: '#DC2626',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}
    </div>
  );
};

export default FileUpload;