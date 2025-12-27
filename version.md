<table border="1">
  <thead>
    <tr>
      <th>Sl No.</th>
      <th>Version</th>
      <th>Modifications</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>v1.0.0</td>
      <td>
        <ul>
          <li>Initial Project Setup</li>
          <li>Basic README documentation</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td>2</td>
      <td>v1.1.0</td>
      <td>
        <ul>
          <li><strong>UI Refinements:</strong> Glassmorphic header, footer redesign (no Google links), black text adjustments on Landing/Auth pages.</li>
          <li><strong>Branding:</strong> Replaced placeholder logo with <code>Logo.png</code> (circular style) for Navbar, Footer, and Favicon.</li>
          <li><strong>Admin Security:</strong> Implemented <code>AdminRoute</code> and whitelist logic for <code>workingspace4321@gmail.com</code>.</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td>3</td>
      <td>v1.2.0</td>
      <td>
        <ul>
          <li><strong>Users Management:</strong> Added Admin-side Users table listing all users (excluding admin) with name, email, status, items submitted count, and joined date.</li>
          <li><strong>User Actions:</strong> View button opens a modal displaying user details and their submitted items.</li>
          <li><strong>Fraud Control:</strong> Block/Unblock toggle with confirmation, updating user status in real time.</li>
          <li><strong>Security Enforcement:</strong> Blocked users are immediately signed out, cannot log in, access the dashboard, or submit items.</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>