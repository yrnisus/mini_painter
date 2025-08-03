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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const handleFileSelect = async (file: File) => {
    console.log('File selected:', file.name);
    setError(null);
    
    try {
      // First, handle the file upload for 3D display
      console.log('Calling onFileUpload...');
      onFileUpload(file);
      
      // Then send to backend for AI analysis
      console.log('Starting backend analysis...');
      await analyzeWithBackend(file);
    } catch (error) {
      console.error('Error in handleFileSelect:', error);
      setError(`File processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const analyzeWithBackend = async (file: File) => {
    setIsAnalyzing(true);
    
    try {
      console.log('Checking backend health...');
      
      // Check if backend is available
      const healthCheck = await fetch('http://localhost:5000/health');
      if (!healthCheck.ok) {
        throw new Error('Backend server is not responding');
      }

      console.log('Backend is healthy, sending file for analysis...');

      // Send file for analysis
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:5000/analyze-model', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const analysisData = await response.json();
      console.log('Analysis response:', analysisData);
      
      if (analysisData.success) {
        onAnalysisComplete(analysisData);
        setAnalysisComplete(true);
        console.log('AI Analysis complete:', analysisData);
        
        // Clear success message after 3 seconds
        setTimeout(() => setAnalysisComplete(false), 3000);
      } else {
        throw new Error(analysisData.error || 'Analysis failed');
      }

    } catch (error) {
      console.error('Backend analysis error:', error);
      setError(`AI Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Continue with basic functionality even if AI analysis fails
      onAnalysisComplete({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback: true
      });
    } finally {
      setIsAnalyzing(false);
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
        disabled={isLoading || isAnalyzing}
        style={{
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          padding: '12px 24px',
          background: (isLoading || isAnalyzing) ? '#9CA3AF' : 'linear-gradient(to right, #3B82F6, #8B5CF6)',
          color: 'white', 
          borderRadius: '8px', 
          border: 'none',
          cursor: (isLoading || isAnalyzing) ? 'not-allowed' : 'pointer', 
          fontSize: '16px', 
          fontWeight: '500',
          minWidth: '200px'
        }}
      >
        <Upload size={20} />
        {isAnalyzing ? 'Analyzing with AI...' : 
         isLoading ? 'Loading Model...' : 
         'Upload STL Model'}
      </button>

      {/* Status indicators */}
      {isAnalyzing && (
        <div style={{
          marginTop: '8px',
          fontSize: '14px',
          color: '#6B7280',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div style={{
            width: '16px',
            height: '16px',
            border: '2px solid #3B82F6',
            borderTop: '2px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <div>
            🤖 AI is analyzing your model for smart segmentation...
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
              This may take 30-60 seconds for complex models
            </div>
          </div>
        </div>
      )}

      {analysisComplete && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          backgroundColor: '#ECFDF5',
          border: '1px solid #A7F3D0',
          borderRadius: '6px',
          fontSize: '14px',
          color: '#065F46',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          ✅ AI analysis complete! Smart masking groups applied.
        </div>
      )}

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

      {/* CSS for animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default FileUpload;