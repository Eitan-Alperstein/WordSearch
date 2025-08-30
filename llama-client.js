// llama-client.js using the official ollama npm package
const ollama = require('ollama');

class LlamaClient {
  constructor(options = {}) {
    this.model = options.model || 'llama3.2';
    this.options = options;
  }

  /**
   * Simple method to get a response from the LLM
   * @param {string} prompt - The input prompt
   * @param {Object} options - Optional parameters to override defaults
   * @returns {Promise<string>} - The LLM response
   */
  async ask(prompt, options = {}) {
    try {
      const result = await ollama.generate({
        model: this.model,
        prompt,
        options: { ...this.options, ...options },
        stream: false
      });
      return result.response;
    } catch (error) {
      throw new Error(`Ollama error: ${error.message}`);
    }
  }

  /**
   * Streaming method for real-time responses
   * @param {string} prompt - The input prompt
   * @param {Function} onChunk - Callback function for each chunk
   * @param {Object} options - Optional parameters
   * @returns {Promise<string>} - Complete response when done
   */
  async askStream(prompt, onChunk, options = {}) {
    let fullResponse = '';
    try {
      for await (const chunk of ollama.generate({
        model: this.model,
        prompt,
        options: { ...this.options, ...options },
        stream: true
      })) {
        if (chunk.response) {
          fullResponse += chunk.response;
          if (onChunk) onChunk(chunk.response);
        }
      }
      return fullResponse;
    } catch (error) {
      throw new Error(`Ollama error: ${error.message}`);
    }
  }

  /**
   * Chat method for conversation-style interactions
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Optional parameters
   * @returns {Promise<string>} - The assistant's response
   */
  async chat(messages, options = {}) {
    try {
      const result = await ollama.chat({
        model: this.model,
        messages,
        options: { ...this.options, ...options },
        stream: false
      });
      return result.message.content;
    } catch (error) {
      throw new Error(`Ollama error: ${error.message}`);
    }
  }

  /**
   * List available models
   * @returns {Promise<Array>} - Array of available models
   */
  async listModels() {
    try {
      const result = await ollama.list();
      return result.models.map(model => model.name);
    } catch (error) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  }

  /**
   * Pull a model from Ollama registry
   * @param {string} modelName - Name of the model to pull
   * @returns {Promise<void>}
   */
  async pullModel(modelName) {
    try {
      for await (const progress of ollama.pull({ model: modelName })) {
        // Optionally handle progress
      }
    } catch (error) {
      throw new Error(`Failed to pull model ${modelName}: ${error.message}`);
    }
  }
}

// Convenience function for quick usage
async function quickAsk(prompt, options = {}) {
  const client = new LlamaClient(options);
  return await client.ask(prompt, options);
}

module.exports = {
  LlamaClient,
  quickAsk
};